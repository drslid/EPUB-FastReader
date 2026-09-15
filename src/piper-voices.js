// One explicitly downloadable Piper Medium voice per supported book language.
// Models/configs are pinned and SHA-256 verified against downloaded upstream files.
// Dataset licences are recorded per voice; retain each original model card.
export const PIPER_REVISION = "1162a9173d0ce503555aed757976b7a9912eae4c";

const freezeVoice = (voice) => Object.freeze({
  ...voice,
  model: Object.freeze(voice.model),
  config: Object.freeze(voice.config),
  modelCard: Object.freeze(voice.modelCard),
  license: Object.freeze(voice.license),
});

export const PIPER_VOICES = Object.freeze([
  {
    "id": "piper-fr_FR-siwis-medium",
    "language": "fr",
    "locale": "fr-FR",
    "name": "Siwis",
    "modelKey": "fr_FR-siwis-medium",
    "modelPath": "models/fr_FR-siwis-medium/model.onnx",
    "configPath": "models/fr_FR-siwis-medium/config.json",
    "sampleRate": 22050,
    "espeakVoice": "fr",
    "speakerId": null,
    "upstreamRevision": "1162a9173d0ce503555aed757976b7a9912eae4c",
    "model": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx",
      "bytes": 63201294,
      "sha256": "641d1ab097da2b81128c076810edb052b385decc8be3381814802a64a73baf99"
    },
    "config": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json",
      "bytes": 4875,
      "sha256": "39479916c2db192b5ac9764daddd0c744d83e023ad890c6976c0633ae4df8959"
    },
    "modelCard": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/fr/fr_FR/siwis/medium/MODEL_CARD",
      "bytes": 284,
      "sha256": "bd8b8d079d4d3d2c4cc20345889bbcd586d72f021a132f93357a763eb5232cce"
    },
    "license": {
      "dataset": "CC-BY-4.0",
      "url": "https://creativecommons.org/licenses/by/4.0/",
      "datasetUrl": "https://doi.org/10.7488/ds/1705",
      "attribution": "SIWIS French Speech Synthesis Database (2017): Junichi Yamagishi, Pierre-Edouard Honnet, Philip Garner and Alexandros Lazaridis; University of Edinburgh. Piper Siwis model by the Piper contributors."
    }
  },
  {
    "id": "piper-en_US-ljspeech-medium",
    "language": "en",
    "locale": "en-US",
    "name": "LJ Speech",
    "modelKey": "en_US-ljspeech-medium",
    "modelPath": "models/en_US-ljspeech-medium/model.onnx",
    "configPath": "models/en_US-ljspeech-medium/config.json",
    "sampleRate": 22050,
    "espeakVoice": "en",
    "speakerId": null,
    "upstreamRevision": "1162a9173d0ce503555aed757976b7a9912eae4c",
    "model": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx",
      "bytes": 63531379,
      "sha256": "6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22"
    },
    "config": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json",
      "bytes": 4972,
      "sha256": "141d612cc0a95ed7efc1ca936b845c2364967f2e9217c5dbfcf69fc4d6c65860"
    },
    "modelCard": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/en/en_US/ljspeech/medium/MODEL_CARD",
      "bytes": 517,
      "sha256": "fbee1529c89d36b3fe76d7e9f3f832dce17f44900a52d76a9bda735654766b4d"
    },
    "license": {
      "dataset": "Public-Domain",
      "url": "https://keithito.com/LJ-Speech-Dataset/",
      "datasetUrl": "https://keithito.com/LJ-Speech-Dataset/",
      "attribution": "LJ Speech Dataset: Linda Johnson (LibriVox recordings) and Keith Ito (alignment and annotation). Piper LJ Speech model contributed by Bryce Beattie, trained from scratch."
    }
  },
  {
    "id": "piper-es_ES-davefx-medium",
    "language": "es",
    "locale": "es-ES",
    "name": "Davefx",
    "modelKey": "es_ES-davefx-medium",
    "modelPath": "models/es_ES-davefx-medium/model.onnx",
    "configPath": "models/es_ES-davefx-medium/config.json",
    "sampleRate": 22050,
    "espeakVoice": "es",
    "speakerId": null,
    "upstreamRevision": "1162a9173d0ce503555aed757976b7a9912eae4c",
    "model": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx",
      "bytes": 63201294,
      "sha256": "6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917"
    },
    "config": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/es/es_ES/davefx/medium/es_ES-davefx-medium.onnx.json",
      "bytes": 4817,
      "sha256": "0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842"
    },
    "modelCard": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/es/es_ES/davefx/medium/MODEL_CARD",
      "bytes": 276,
      "sha256": "420703b5d8ea239b729f13d83f31eea9bae5fcb89447de23ebc94aa8a4768f95"
    },
    "license": {
      "dataset": "CC0-1.0",
      "url": "https://creativecommons.org/publicdomain/zero/1.0/",
      "datasetUrl": "https://github.com/OHF-Voice/voice-datasets",
      "attribution": "Davefx voice contribution and Piper/Open Home Foundation voice-dataset contributors."
    }
  },
  {
    "id": "piper-it_IT-paola-medium",
    "language": "it",
    "locale": "it-IT",
    "name": "Paola",
    "modelKey": "it_IT-paola-medium",
    "modelPath": "models/it_IT-paola-medium/model.onnx",
    "configPath": "models/it_IT-paola-medium/config.json",
    "sampleRate": 22050,
    "espeakVoice": "it",
    "speakerId": null,
    "upstreamRevision": "1162a9173d0ce503555aed757976b7a9912eae4c",
    "model": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/it/it_IT/paola/medium/it_IT-paola-medium.onnx",
      "bytes": 63511038,
      "sha256": "6fc918b5a0ea6137382833dddfa567bffbe6a5060c02043c87192ee59c04210c"
    },
    "config": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/it/it_IT/paola/medium/it_IT-paola-medium.onnx.json",
      "bytes": 7099,
      "sha256": "aea19c0a7fce29fbc359b93f10e7902854401e4c95ae2ea328ae516b15d296cf"
    },
    "modelCard": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/it/it_IT/paola/medium/MODEL_CARD",
      "bytes": 303,
      "sha256": "c53fd0070dc93b438edbce06728eb83759ba030fff0cce523209ee4a0a6363c0"
    },
    "license": {
      "dataset": "CC0-1.0",
      "url": "https://creativecommons.org/publicdomain/zero/1.0/",
      "datasetUrl": "https://huggingface.co/datasets/paolapersico1/Voice-Dataset-Italian",
      "attribution": "Paola Persico, Voice-Dataset-Italian, and Piper contributors."
    }
  },
  {
    "id": "piper-de_DE-thorsten-medium",
    "language": "de",
    "locale": "de-DE",
    "name": "Thorsten",
    "modelKey": "de_DE-thorsten-medium",
    "modelPath": "models/de_DE-thorsten-medium/model.onnx",
    "configPath": "models/de_DE-thorsten-medium/config.json",
    "sampleRate": 22050,
    "espeakVoice": "de",
    "speakerId": null,
    "upstreamRevision": "1162a9173d0ce503555aed757976b7a9912eae4c",
    "model": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx",
      "bytes": 63201294,
      "sha256": "7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819"
    },
    "config": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx.json",
      "bytes": 4819,
      "sha256": "974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85"
    },
    "modelCard": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/de/de_DE/thorsten/medium/MODEL_CARD",
      "bytes": 285,
      "sha256": "5196b5ab0794e6056263a1f37c18bec407b61ac187529bee29d1c366871e5c9e"
    },
    "license": {
      "dataset": "CC0-1.0",
      "url": "https://creativecommons.org/publicdomain/zero/1.0/",
      "datasetUrl": "https://github.com/thorstenMueller/Thorsten-Voice",
      "attribution": "Thorsten-Voice: Thorsten Müller and Dominik Kreutz; Piper contributors."
    }
  },
  {
    "id": "piper-pt_BR-faber-medium",
    "language": "pt",
    "locale": "pt-BR",
    "name": "Faber",
    "modelKey": "pt_BR-faber-medium",
    "modelPath": "models/pt_BR-faber-medium/model.onnx",
    "configPath": "models/pt_BR-faber-medium/config.json",
    "sampleRate": 22050,
    "espeakVoice": "pt-br",
    "speakerId": null,
    "upstreamRevision": "1162a9173d0ce503555aed757976b7a9912eae4c",
    "model": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx",
      "bytes": 63201294,
      "sha256": "858555e3a064209c57088fe6bd70c4c3dc54d03eaa00c45d5ecaf43a33f95aa7"
    },
    "config": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx.json",
      "bytes": 4855,
      "sha256": "7e694de195ae3fc36dd732c445eb04fb49b649854893cb5506b978f0d50a1d6f"
    },
    "modelCard": {
      "url": "https://huggingface.co/rhasspy/piper-voices/resolve/1162a9173d0ce503555aed757976b7a9912eae4c/pt/pt_BR/faber/medium/MODEL_CARD",
      "bytes": 279,
      "sha256": "01f1a5bcfd0538782726059ae407eae9c2dd1b5b35f7298fd53a68de91afe563"
    },
    "license": {
      "dataset": "CC0-1.0",
      "url": "https://creativecommons.org/publicdomain/zero/1.0/",
      "datasetUrl": "https://github.com/OHF-Voice/voice-datasets",
      "attribution": "Faber voice contribution and Piper/Open Home Foundation voice-dataset contributors."
    }
  }
].map(freezeVoice));
