import { useCallback } from 'react';

export function useTTS() {
    const speak = useCallback((text: string) => {
        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            // Optional: Set voice, rate, pitch
            // utterance.rate = 1;
            // utterance.pitch = 1;
            window.speechSynthesis.cancel(); // Stop previous speech
            window.speechSynthesis.speak(utterance);
        } else {
            console.warn('Text-to-speech not supported in this browser.');
        }
    }, []);

    return { speak };
}
