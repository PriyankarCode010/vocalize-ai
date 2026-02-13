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

    const sentenceString = sentence.reduce((acc, current, index) => {
        if (index === 0) return current === ' ' ? '' : current;
        const prev = sentence[index - 1];

        // If current is an explicit space gesture
        if (current === ' ') return acc.endsWith(' ') ? acc : acc + ' ';

        // If previous was a space, just append
        if (prev === ' ') return acc + current;

        // If both are single characters (fingerspelling), join without space
        if (current.length === 1 && prev.length === 1) {
            return acc + current;
        }

        // Otherwise, add a space before the new word
        return acc.endsWith(' ') ? acc + current : acc + ' ' + current;
    }, '');

    return {
        sentence,
        addToSentence,
        clearSentence,
        sentenceString
    };
}
