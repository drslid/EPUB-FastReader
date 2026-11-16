// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createPocketDecoderPeer } from "../src/pocket-decoder-client.js";

const runtimeUrl = new URL("https://reader.example/voice-runtime/v2/");

function mockWorker() {
  const worker = {
    terminate: vi.fn(),
    postMessage: vi.fn((value, transfer = []) => {
      const message = structuredClone(value, { transfer });
      if (message.type !== "decode") queueMicrotask(() => worker.onmessage({ data: { id: message.id } }));
      return message;
    }),
  };
  return worker;
}

describe("the optional Pocket decoder worker", () => {
  it("keeps the original latent frames available for local recovery", async () => {
    const worker = mockWorker();
    const createWorker = vi.fn(() => worker);
    const peer = await createPocketDecoderPeer({ runtimeUrl, workerFactory: createWorker });
    await peer.start();

    const input = Float32Array.of(1, 2, 3);
    const decoding = peer.decode(input);
    const sent = worker.postMessage.mock.results.at(-1).value;
    expect(sent.latents).toEqual(input);
    expect([...input]).toEqual([1, 2, 3]);
    const pcm = Float32Array.of(0.3);
    worker.onmessage({ data: { id: sent.id, result: pcm } });
    await expect(decoding).resolves.toBe(pcm);
    expect(createWorker).toHaveBeenCalledWith(new URL("pocket-decoder-worker.js", runtimeUrl));
    await peer.close();
    peer.terminate();
  });

  it("rejects ongoing work when the worker fails so the caller can replay locally", async () => {
    const worker = mockWorker();
    const peer = await createPocketDecoderPeer({ runtimeUrl, workerFactory: () => worker });
    const expected = expect(peer.decode(Float32Array.of(1))).rejects.toThrow("Decoder crashed");
    worker.onerror({ message: "Decoder crashed" });
    await expected;
    await expect(peer.start()).rejects.toThrow("Decoder crashed");
    peer.terminate();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("abandons a worker that stops reporting progress", async () => {
    vi.useFakeTimers();
    try {
      const worker = mockWorker();
      const peer = await createPocketDecoderPeer({ runtimeUrl, workerFactory: () => worker, timeoutMs: 10 });
      const expected = expect(peer.decode(Float32Array.of(1))).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(10);
      await expected;
      expect(worker.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
