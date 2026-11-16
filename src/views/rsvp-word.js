import { splitRsvpWord } from "../rsvp-pivot.js";

const edgeSpace = 12;

export function renderRsvpWord(element, word, fixation) {
  element.parentElement.toggleAttribute("data-fixation", fixation);
  if (!fixation) {
    element.textContent = word;
    return;
  }

  const { before, pivot, after } = splitRsvpWord(word);
  if (!pivot) {
    element.textContent = word;
    return;
  }

  const letter = element.ownerDocument.createElement("span");
  letter.className = "rsvp-pivot-letter";
  letter.textContent = pivot;
  element.replaceChildren(before, letter, after);
}

function fixationOffset(letter, bounds) {
  if (!letter) return bounds.width / 2;
  const letterBounds = letter.getBoundingClientRect();
  return letterBounds.left + letterBounds.width / 2 - bounds.left;
}

export function fitRsvpWord(element) {
  const stage = element.parentElement;
  if (!stage.clientWidth) return;

  element.style.fontSize = "";
  element.style.transform = "";
  element.style.removeProperty("--rsvp-offset");

  if (!stage.hasAttribute("data-fixation")) {
    const available = Math.max(1, stage.clientWidth - 36);
    const width = element.getBoundingClientRect().width;
    if (width <= available) return;

    const baseSize = parseFloat(getComputedStyle(element).fontSize);
    element.style.fontSize = `${Math.max(18, (baseSize * available) / width)}px`;
    const fittedWidth = element.getBoundingClientRect().width;
    if (fittedWidth > available)
      element.style.transform = `scaleX(${available / fittedWidth})`;
    return;
  }

  // At zero translation, the left edge of the word is on the same CSS axis as the rails.
  const stageBounds = stage.getBoundingClientRect();
  const letter = element.querySelector(".rsvp-pivot-letter");
  let bounds = element.getBoundingClientRect();
  let offset = fixationOffset(letter, bounds);
  const leftSpace = Math.max(1, bounds.left - stageBounds.left - edgeSpace);
  const rightSpace = Math.max(1, stageBounds.right - bounds.left - edgeSpace);
  const scale = Math.min(1, leftSpace / offset, rightSpace / (bounds.width - offset));
  if (scale < 1) {
    const baseSize = parseFloat(getComputedStyle(element).fontSize);
    element.style.fontSize = `${baseSize * scale}px`;
    bounds = element.getBoundingClientRect();
    offset = fixationOffset(letter, bounds);
  }
  element.style.setProperty("--rsvp-offset", `${-offset}px`);
}
