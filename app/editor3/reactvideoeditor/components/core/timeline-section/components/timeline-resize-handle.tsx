import React from 'react';

interface TimelineResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  isResizing: boolean;
}

/**
 * Draggable resize handle component for the timeline
 * Allows users to adjust the height of the timeline by dragging up or down
 * Supports both mouse and touch interactions for mobile devices
 */
export const TimelineResizeHandle: React.FC<TimelineResizeHandleProps> = ({ 
  onMouseDown, 
  onTouchStart,
  isResizing 
}) => {
  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={`
        timeline-resize-handle
        cursor-ns-resize
        block relative w-full
        ${isResizing ? '' : ''}
      `}
      style={{
        touchAction: 'none',
        height: '24px',
        background: '#000',
        pointerEvents: 'auto',
        zIndex: 5,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Visual indicator for the resize handle */}
      <div
        className="absolute inset-0"
        style={{
          pointerEvents: 'none',
        }}
      />

    </div>
  );
};

