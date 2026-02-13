import { useState, useCallback, useRef, useEffect } from 'react';

interface SubtitleData {
  text: string;
  timestamp: number;
  isFinal: boolean;
}

interface UseSubtitlesReturn {
  localSubtitles: string;
  remoteSubtitles: string;
  addLocalPrediction: (prediction: string) => void;
  addRemoteSubtitle: (data: SubtitleData) => void;
  clearLocalSubtitles: () => void;
  clearRemoteSubtitles: () => void;
  getSubtitleData: () => SubtitleData;
}

export function useSubtitles(): UseSubtitlesReturn {
  const [localSentence, setLocalSentence] = useState<string[]>([]);
  const [remoteSubtitles, setRemoteSubtitles] = useState<string>('');
  
  const lastWordRef = useRef<string>('');
  const lastWordTimeRef = useRef<number>(0);
  const debounceTimeRef = useRef<number>(1000); // 1 second debounce
  
  // Format sentence by merging consecutive single characters into words
  const formatSentence = useCallback((words: string[]): string => {
    if (words.length === 0) return '';
    
    const formatted: string[] = [];
    let currentWord = '';
    let lastCharWasSpace = false;
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      
      if (word === ' ') {
        if (currentWord) {
          formatted.push(currentWord);
          currentWord = '';
        }
        if (!lastCharWasSpace) {
          formatted.push(' ');
          lastCharWasSpace = true;
        }
      } else if (word.length === 1 && word.match(/[A-Za-z]/)) {
        // Single character, likely fingerspelling
        currentWord += word;
        lastCharWasSpace = false;
      } else {
        // Multi-character word
        if (currentWord) {
          formatted.push(currentWord);
          currentWord = '';
        }
        formatted.push(word);
        lastCharWasSpace = false;
      }
    }
    
    if (currentWord) {
      formatted.push(currentWord);
    }
    
    return formatted.join('').replace(/\s+/g, ' ').trim();
  }, []);

  // Add local prediction with debouncing
  const addLocalPrediction = useCallback((prediction: string) => {
    const now = Date.now();
    
    setLocalSentence(prev => {
      let newSentence = [...prev];
      
      // Handle special commands
      if (prediction === 'space') {
        if (newSentence.length > 0 && newSentence[newSentence.length - 1] !== ' ') {
          newSentence.push(' ');
        }
        return newSentence;
      }
      
      if (prediction === 'clear') {
        return [];
      }
      
      if (prediction === 'delete') {
        return newSentence.slice(0, -1);
      }
      
      // Handle "no sign detected" - add space if last character wasn't space
      if (prediction === 'no_sign_detected' || prediction === 'no sign found') {
        if (newSentence.length > 0 && newSentence[newSentence.length - 1] !== ' ') {
          newSentence.push(' ');
        }
        return newSentence;
      }
      
      // Skip empty predictions
      if (!prediction || !prediction.trim()) {
        return newSentence;
      }
      
      // Enhanced debouncing logic
      const timeSinceLastWord = now - lastWordTimeRef.current;
      const isDifferentWord = prediction !== lastWordRef.current;
      const shouldAdd = isDifferentWord || timeSinceLastWord > debounceTimeRef.current;
      
      if (shouldAdd) {
        newSentence.push(prediction);
        lastWordRef.current = prediction;
        lastWordTimeRef.current = now;
      }
      
      return newSentence;
    });
  }, []);

  // Add remote subtitle (received from other user)
  const addRemoteSubtitle = useCallback((data: SubtitleData) => {
    setRemoteSubtitles(data.text);
  }, []);

  // Clear functions
  const clearLocalSubtitles = useCallback(() => {
    setLocalSentence([]);
    lastWordRef.current = '';
    lastWordTimeRef.current = 0;
  }, []);

  const clearRemoteSubtitles = useCallback(() => {
    setRemoteSubtitles('');
  }, []);

  // Get formatted subtitle data for sending
  const getSubtitleData = useCallback((): SubtitleData => {
    const formattedText = formatSentence(localSentence);
    const isFinal = formattedText.endsWith(' ') || formattedText.endsWith('.') || formattedText.endsWith('!');
    
    return {
      text: formattedText,
      timestamp: Date.now(),
      isFinal
    };
  }, [localSentence, formatSentence]);

  const localSubtitles = formatSentence(localSentence);

  return {
    localSubtitles,
    remoteSubtitles,
    addLocalPrediction,
    addRemoteSubtitle,
    clearLocalSubtitles,
    clearRemoteSubtitles,
    getSubtitleData
  };
}
