import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  show: boolean;
  onClose: () => void;
  title?: string;
  maxWidth?: string;
  children: ReactNode;
  showCloseButton?: boolean;
  centerContent?: boolean;
}

export function Modal({
  show,
  onClose,
  title,
  maxWidth = 'max-w-md',
  children,
  showCloseButton = true,
  centerContent = false,
}: ModalProps) {
  if (!show) return null;
  return (
    <div
      className="fixed inset-0 bg-[var(--bg-overlay)] flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-[var(--bg-panel)] rounded-2xl shadow-lg ${maxWidth} w-full p-6 max-h-[90vh] overflow-y-auto${centerContent ? ' text-center' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        {(title || showCloseButton) && (
          <div className={`flex items-center ${title ? 'justify-between' : 'justify-end'} mb-4`}>
            {title && (
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
            )}
            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-2 -m-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xl leading-none"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
