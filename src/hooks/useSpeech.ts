import { useCallback, useRef } from 'react';

interface UseSpeechReturn {
    speak: (text: string, onComplete?: () => void) => void;
    stop: () => void;
    isSpeaking: boolean;
}

export function useSpeech(): UseSpeechReturn {
    const isSpeakingRef = useRef(false);
    const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

    // Format text for natural speech
    const formatText = useCallback((text: string): string => {
        if (!text || !text.trim()) return '';
        
        // Remove extra spaces and normalize
        let formatted = text.trim().replace(/\s+/g, ' ');
        
        // Capitalize first letter of sentences
        formatted = formatted.replace(/(^[a-z])|(\.\s*[a-z])/g, (match) => match.toUpperCase());
        
        // Ensure proper spacing after punctuation
        formatted = formatted.replace(/([.!?])([^\s])/g, '$1 $2');
        
        // Handle common ASL-to-text issues - merge consecutive single characters
        const words = formatted.split(' ');
        const mergedWords: string[] = [];
        let currentWord = '';
        
        for (const word of words) {
            if (word.length === 1 && word.match(/[A-Za-z]/)) {
                // Single character, likely fingerspelling
                currentWord += word;
            } else {
                if (currentWord) {
                    mergedWords.push(currentWord);
                    currentWord = '';
                }
                mergedWords.push(word);
            }
        }
        
        if (currentWord) {
            mergedWords.push(currentWord);
        }
        
        return mergedWords.join(' ').trim();
    }, []);

    const speak = useCallback((text: string, onComplete?: () => void): void => {
        if (!('speechSynthesis' in window)) {
            console.warn('Text-to-speech not supported in this browser.');
            return;
        }

        const formattedText = formatText(text);
        
        if (!formattedText) {
            console.log('[useSpeech] No text to speak after formatting');
            return;
        }

        console.log('[useSpeech] Speaking:', formattedText);

        // Stop any current speech
        window.speechSynthesis.cancel();
        
        // Create new utterance
        const utterance = new SpeechSynthesisUtterance(formattedText);
        
        // Configure for natural speech
        utterance.rate = 0.9; // Slightly slower for clarity
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        
        // Try to use a natural voice
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(voice => 
            voice.name.includes('Natural') || 
            voice.name.includes('Google') ||
            voice.lang.startsWith('en')
        );
        
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }
        
        // Track speaking state
        isSpeakingRef.current = true;
        currentUtteranceRef.current = utterance;
        
        utterance.onend = () => {
            console.log('[useSpeech] Speech completed');
            isSpeakingRef.current = false;
            currentUtteranceRef.current = null;
            if (onComplete) {
                onComplete();
            }
        };
        
        utterance.onerror = (event) => {
            console.error('[useSpeech] Speech error:', event);
            isSpeakingRef.current = false;
            currentUtteranceRef.current = null;
        };
        
        // Start speaking
        window.speechSynthesis.speak(utterance);
    }, [formatText]);

    const stop = useCallback((): void => {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            isSpeakingRef.current = false;
            currentUtteranceRef.current = null;
        }
    }, []);

    return { speak, stop, isSpeaking: isSpeakingRef.current };
}
