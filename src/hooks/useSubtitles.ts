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
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      
      if (word === ' ') {
        if (currentWord) {
          formatted.push(currentWord);
          currentWord = '';
        }
        formatted.push(' ');
      } else if (word.length === 1) {
        // Single character, likely fingerspelling
        currentWord += word;
      } else {
        // Multi-character word
        if (currentWord) {
          formatted.push(currentWord);
          currentWord = '';
        }
        formatted.push(word);
      }
    }
    
    if (currentWord) {
      formatted.push(currentWord);
    }
    
    return formatted.join('').trim();
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
      
      // Debounce logic - only add if different from last word or enough time passed
      const timeSinceLastWord = now - lastWordTimeRef.current;
      const isDifferentWord = prediction !== lastWordRef.current;
      const shouldAdd = isDifferentWord || timeSinceLastWord > debounceTimeRef.current;
      
      if (shouldAdd && prediction.trim()) {
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
