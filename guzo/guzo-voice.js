/** Voice input - wired in Phase 3 (Web Speech API). */
export function initVoice() {
    // Mic buttons remain disabled in Phase 1 UI shell.
}

export function isVoiceSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}
