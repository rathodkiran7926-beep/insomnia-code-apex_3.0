import React from 'react';

interface BlueprintPatternProps {
  position?: 'left' | 'right' | 'both';
  className?: string;
  opacity?: number;
}

export const BlueprintPattern: React.FC<BlueprintPatternProps> = () => {
  // Disabled decorative square columns to keep background clean and unobstructed
  return null;
};
