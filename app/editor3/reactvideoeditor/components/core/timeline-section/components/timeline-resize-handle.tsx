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
        className="absolute inset-0 pointer-events-none flex items-center justify-center"
        aria-hidden="true"
      >
        <div
        className="
            flex flex-col items-center justify-center gap-0.5 rounded-md
            border border-white/14
            bg-white/8
            px-3 py-0.5
            shadow-[0_4px_10px_-8px_rgba(0,0,0,0.7)]
            backdrop-blur-[1px]
            transition-colors duration-150
          "
        >
          <span className="h-0.5 w-10 rounded-full bg-white/75" />
          <span className="h-0.5 w-8 rounded-full bg-white/60" />
        </div>
      </div>
    </div>
  );
};

