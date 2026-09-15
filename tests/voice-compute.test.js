import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAcceleratedVoiceEngine, voiceComputePolicy } from '../src/voice-compute.js';

const capable = { hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'Desktop Chromium' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const audio = label => ({ blob: new Blob([label], { type: 'audio/wav' }), duration: 1 });
const voice = { id: 'ff_siwis' };

function setup(overrides = {}) {
  const engines = [], calls = [];
  const createEngine = vi.fn(options => {
    const index = engines.length;
    const engine = {
      load: vi.fn(async (value, args) => { calls.push({ index, type: 'load', voice: value, ...args }); return { ready: true }; }),
      synthesize: vi.fn(async (text, args) => { calls.push({ index, type: 'synthesize', text, ...args }); return audio(text); }),
      dispose: vi.fn(),
    };
    engines.push(engine);
    overrides.configure?.(engine, index, options);
    return engine;
  });
  const onProgress = vi.fn();
  const pool = createAcceleratedVoiceEngine({ navigator: capable, crossOriginIsolated: false, createEngine, onProgress, ...overrides });
  return { pool, engines, calls, createEngine, onProgress };
}

afterEach(() => vi.useRealTimers());

describe('local speech compute policy', () => {
  it('uses two models only with explicit sufficient memory and CPU', () => {
    expect(voiceComputePolicy({ navigator: capable })).toEqual({ concurrency: 2, wasmThreads: 1, mode: 'parallel' });
    for (const navigator of [{ hardwareConcurrency: 16 }, { ...capable, deviceMemory: 4 }, { ...capable, hardwareConcurrency: 2 }, undefined]) {
      expect(voiceComputePolicy({ navigator, crossOriginIsolated: false }).concurrency).toBe(1);
    }
  });
  it('keeps phones and tablets on one session even with ample memory and isolation', () => {
    const android = { ...capable, userAgent: 'Android Mobile' };
    expect(voiceComputePolicy({ navigator: android, crossOriginIsolated: true })).toEqual({ concurrency: 1, wasmThreads: 1, mode: 'portable' });
    expect(voiceComputePolicy({ navigator: android }).concurrency).toBe(1);
    expect(voiceComputePolicy({ navigator: { ...android, hardwareConcurrency: 4 } }).concurrency).toBe(1);
    expect(voiceComputePolicy({ navigator: { hardwareConcurrency: 8, userAgent: 'iPhone' } }).concurrency).toBe(1);
    expect(voiceComputePolicy({ navigator: { ...capable, hardwareConcurrency: 4, platform: 'MacIntel', maxTouchPoints: 5 } }).concurrency).toBe(1);
  });
  it('uses threads in one model only under explicit isolation', () => {
    expect(voiceComputePolicy({ navigator: capable, crossOriginIsolated: true })).toEqual({ concurrency: 1, wasmThreads: 4, mode: 'multithread' });
    expect(voiceComputePolicy({ navigator: { ...capable, hardwareConcurrency: 4 }, crossOriginIsolated: true }).wasmThreads).toBe(2);
    expect(voiceComputePolicy({ navigator: { ...capable, deviceMemory: undefined }, crossOriginIsolated: true }).wasmThreads).toBe(1);
  });
});

describe('accelerated local speech pool', () => {
  it('creates nothing until requested and exposes reserved concurrency', () => {
    const { pool, createEngine } = setup();
    expect(pool.concurrency).toBe(2);
    expect(createEngine).not.toHaveBeenCalled();
    pool.dispose();
    expect(createEngine).not.toHaveBeenCalled();
  });

  it('keeps the second model lazy until passage two and never makes passage one wait for it', async () => {
    vi.useFakeTimers();
    const secondLoad = deferred(), firstAudio = deferred();
    const { pool, engines } = setup({ configure(engine, index) {
      if (index === 1) engine.synthesize.mockImplementation(async text => { await secondLoad.promise; return audio(text); });
      else engine.synthesize.mockImplementation(() => firstAudio.promise);
    } });
    await pool.load(voice);
    expect(engines).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(engines).toHaveLength(1);
    const first = pool.synthesize('First.', { voice });
    const second = pool.synthesize('Second.', { voice });
    await flush();
    expect(engines[0].synthesize).toHaveBeenCalledOnce();
    expect(engines[1].synthesize).toHaveBeenCalledOnce();
    firstAudio.resolve(audio('First.'));
    await expect(first).resolves.toMatchObject({ duration: 1 });
    secondLoad.resolve({ ready: true });
    await expect(second).resolves.toMatchObject({ duration: 1 });
    expect(engines[1].synthesize.mock.calls[0][0]).toBe('Second.');
    pool.dispose();
  });

  it('runs two passages concurrently but preserves FIFO within each worker', async () => {
    const held = [deferred(), deferred()];
    const { pool, engines } = setup({ configure(engine, index) { engine.synthesize.mockImplementationOnce(() => held[index].promise); } });
    const first = pool.synthesize('A', { voice }), second = pool.synthesize('B', { voice }), third = pool.synthesize('C', { voice });
    await flush();
    expect(engines).toHaveLength(2);
    expect(engines[0].synthesize).toHaveBeenCalledOnce();
    expect(engines[1].synthesize).toHaveBeenCalledOnce();
    held[0].resolve(audio('A'));
    await first; await third;
    expect(engines[0].synthesize.mock.calls.map(call => call[0])).toEqual(['A', 'C']);
    held[1].resolve(audio('B')); await second;
    pool.dispose();
  });

  it('reuses warmed model sessions for later passages and voice changes', async () => {
    const { pool, engines, createEngine } = setup();
    await pool.load(voice);
    await Promise.all([pool.synthesize('A', { voice }), pool.synthesize('B', { voice })]);
    await pool.load({ id: 'af_heart' });
    await pool.synthesize('C', { voice: { id: 'af_heart' } });
    expect(createEngine).toHaveBeenCalledTimes(2);
    expect(engines.every(engine => !engine.dispose.mock.calls.length)).toBe(true);
    pool.dispose();
  });

  it('retries a second-worker failure on the first and reduces concurrency to one', async () => {
    const { pool, engines, onProgress } = setup({ configure(engine, index) {
      if (index === 1) engine.synthesize.mockRejectedValue(Object.assign(new Error('Memory failure'), { code: 'VOICE_FAILED' }));
    } });
    const results = await Promise.all([pool.synthesize('A', { voice }), pool.synthesize('Whole sentence B.', { voice }), pool.synthesize('C', { voice })]);
    expect(results).toHaveLength(3);
    expect(pool.concurrency).toBe(1);
    expect(engines[1].dispose).toHaveBeenCalledOnce();
    expect(engines[0].synthesize.mock.calls.map(call => call[0])).toContain('Whole sentence B.');
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ stage: 'fallback', concurrency: 1 }));
    pool.dispose();
  });

  it('contains optional model-creation failures and keeps the first worker usable', async () => {
    const { pool, engines } = setup({ configure(engine, index) { if (index === 1) throw new Error('Cannot allocate model'); } });
    await pool.load(voice);
    await Promise.all([pool.synthesize('A', { voice }), pool.synthesize('B', { voice })]);
    expect(pool.concurrency).toBe(1);
    await expect(pool.synthesize('Still available.', { voice })).resolves.toMatchObject({ duration: 1 });
    expect(engines[0].synthesize).toHaveBeenCalledTimes(3);
    pool.dispose();
  });

  it('keeps an unused second model uncreated after loading, cancellation or disposal', async () => {
    vi.useFakeTimers();
    for (const cancel of ['abort', 'dispose']) {
      const controller = new AbortController();
      const { pool, engines } = setup();
      await pool.load(voice, { signal: controller.signal });
      if (cancel === 'abort') controller.abort(); else pool.dispose();
      await vi.advanceTimersByTimeAsync(0);
      expect(engines).toHaveLength(1);
      pool.dispose();
    }
  });

  it('preserves a first-worker error instead of hiding it behind a background retry', async () => {
    const { pool, engines } = setup({ configure(engine) {
      engine.synthesize.mockRejectedValue(Object.assign(new Error('First worker crashed'), { code: 'VOICE_FAILED' }));
    } });
    await expect(pool.synthesize('A', { voice })).rejects.toMatchObject({ code: 'VOICE_FAILED' });
    expect(engines).toHaveLength(1);
    expect(pool.concurrency).toBe(2);
    pool.dispose();
  });

  it('does not downgrade for a content error in the second worker', async () => {
    const { pool } = setup({ configure(engine, index) {
      if (index === 1) engine.synthesize.mockRejectedValue(Object.assign(new Error('No text'), { code: 'VOICE_EMPTY_TEXT' }));
    } });
    const results = await Promise.allSettled([pool.synthesize('A', { voice }), pool.synthesize('', { voice })]);
    expect(results[1].reason.code).toBe('VOICE_EMPTY_TEXT');
    expect(pool.concurrency).toBe(2);
    pool.dispose();
  });

  it('rejects queued work immediately on abort and does not fall back from cancellation', async () => {
    const held = deferred(); const controller = new AbortController();
    const { pool, engines } = setup({ navigator: { ...capable, deviceMemory: 4 }, configure(engine) { engine.synthesize.mockImplementationOnce(() => held.promise); } });
    const first = pool.synthesize('A', { voice });
    const queued = pool.synthesize('B', { voice, signal: controller.signal });
    const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    await flush(); controller.abort(); await rejected;
    held.resolve(audio('A')); await first; await flush();
    expect(engines[0].synthesize).toHaveBeenCalledOnce();
    pool.dispose();
  });

  it('disposes both workers and rejects running and queued operations without late audio', async () => {
    const held = [deferred(), deferred()];
    const { pool, engines } = setup({ configure(engine, index) { engine.synthesize.mockImplementation(() => held[index].promise); } });
    const all = Promise.allSettled([pool.synthesize('A', { voice }), pool.synthesize('B', { voice }), pool.synthesize('C', { voice })]);
    await flush(); pool.dispose();
    for (const result of await all) expect(result.reason.name).toBe('AbortError');
    expect(engines.every(engine => engine.dispose.mock.calls.length === 1)).toBe(true);
    held.forEach(item => item.resolve(audio('late'))); await flush();
    expect(engines.reduce((n, engine) => n + engine.synthesize.mock.calls.length, 0)).toBe(2);
  });

  it('reports real stages and forwards per-operation progress with worker identity', async () => {
    const callback = vi.fn();
    const { pool } = setup({ configure(engine) {
      engine.synthesize.mockImplementation(async (text, options) => { options.onProgress({ stage: 'synthesizing', completedFragments: 1, audioDuration: 2.5 }); return audio(text); });
    } });
    await pool.synthesize('A', { voice, onProgress: callback });
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ stage: 'loading', workerIndex: 0 }));
    expect(callback).toHaveBeenCalledWith({ stage: 'synthesizing', completedFragments: 1, audioDuration: 2.5, workerIndex: 0 });
    expect(callback.mock.calls.some(([value]) => 'percent' in value)).toBe(false);
    pool.dispose();
  });
});
