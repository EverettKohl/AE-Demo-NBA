import { FoldVertical } from 'lucide-react';
import { Button } from '../../../ui/button';
import React from 'react';



interface AutoRemoveEmptyTracksToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export const AutoRemoveEmptyTracksToggle: React.FC<AutoRemoveEmptyTracksToggleProps> = ({
  enabled,
  onToggle,
}) => {
  return (
    <div className="hidden md:block">
      <Button
        onClick={() => onToggle(!enabled)}
        variant={enabled ? "outline" : "ghost"}
        size="icon"
        className={`transition-all duration-200 relative ${
          enabled 
            ? 'border-primary ' 
            : ' text-muted-foreground'
        }`}
        onTouchStart={(e) => e.preventDefault()}
        style={{ WebkitTapHighlightColor: 'transparent' }}
        aria-label={enabled ? 'Auto-remove empty tracks' : 'Enable auto-removal of empty tracks'}
      >
        <FoldVertical className={`w-4 h-4 transition-all duration-300 `} />
      </Button>
    </div>
  );
}; 