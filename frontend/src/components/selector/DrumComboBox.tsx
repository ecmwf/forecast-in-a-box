import React, { useState, useEffect, useCallback } from 'react';
import { Card, Stack, Text } from '@mantine/core';
import { motion } from 'framer-motion';

interface DrumComboBoxProps {
  options: string[];
  trigger: any; // Could be a number, string, timestamp, etc.
  defaultIndex?: number; // Optional: default index to start from
  onChange?: (value: string) => void;
  direction?: 'up' | 'down'; // Optional: specify roll direction
}

const DrumComboBox: React.FC<DrumComboBoxProps> = ({
  options,
  trigger,
  defaultIndex,
  onChange,
  direction = 'down',
}) => {
  const [currentIndex, setCurrentIndex] = useState(defaultIndex || 0);

  // External trigger
  useEffect(() => {
    if (direction === 'down') {
      setCurrentIndex((prev) => {
        const nextIndex = (prev + 1) % options.length;
        onChange?.(options[nextIndex]);
        return nextIndex;
      });
    } else {
      setCurrentIndex((prev) => {
        const prevIndex = (prev - 1 + options.length) % options.length;
        onChange?.(options[prevIndex]);
        return prevIndex;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  // Scroll handler
  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (event.deltaY > 0) {
        // Scrolling down
        setCurrentIndex((prev) => {
          const nextIndex = (prev + 1) % options.length;
          onChange?.(options[nextIndex]);
          return nextIndex;
        });
      } else if (event.deltaY < 0) {
        // Scrolling up
        setCurrentIndex((prev) => {
          const prevIndex = (prev - 1 + options.length) % options.length;
          onChange?.(options[prevIndex]);
          return prevIndex;
        });
      }
    },
    [options, onChange]
  );

  const getOption = (index: number) => {
    const adjustedIndex = (index + options.length) % options.length;
    return options[adjustedIndex];
  };

  return (
    <Card
      p="md"
      shadow="md"
      radius="xl"
      w='100%'
      style={{textAlign: 'center', overflow: 'hidden' }}
      onWheel={handleWheel}
    >
      <Stack align="center" gap="xs">
        {/* Previous Option */}
        <Text size="sm" c="dimmed">
          {getOption(currentIndex - 1)}
        </Text>

        {/* Current Option */}
        <motion.div
          key={currentIndex}
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Text size="lg" style={{ maxWidth: 280, wordBreak: 'break-word', whiteSpace: 'pre-line' }}>
            {options[currentIndex]}
          </Text>
        </motion.div>

        {/* Next Option */}
        <Text size="sm" c="dimmed">
          {getOption(currentIndex + 1)}
        </Text>
      </Stack>
    </Card>
  );
};

export default DrumComboBox;
