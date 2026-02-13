import { useState, useCallback } from 'react';

interface UseSentenceBuilderReturn {
    sentence: string[];
    addToSentence: (word: string) => void;
    clearSentence: () => void;
    sentenceString: string;
}

export function useSentenceBuilder(): UseSentenceBuilderReturn {
    const [sentence, setSentence] = useState<string[]>([]);

    const addToSentence = useCallback((word: string) => {
        setSentence(prev => {
            // Special commands
            if (word === 'space') {
                return [...prev, ' '];
            }
            if (word === 'clear') {
                return [];
            }
            if (word === 'delete') {
                return prev.slice(0, -1);
            }

            // Append word (handle spacing logic if needed, but for now just array)
            return [...prev, word];
        });
    }, []);

    const clearSentence = useCallback(() => {
        setSentence([]);
    }, []);

    const sentenceString = sentence.join(' ').replace(/\s\s+/g, ' ').trim();

    return {
        sentence,
        addToSentence,
        clearSentence,
        sentenceString
    };
}
