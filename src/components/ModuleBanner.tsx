import React from 'react';
import { ArrowRight, HelpCircle, AlertTriangle } from 'lucide-react';

interface ModuleBannerProps {
  title: string;
  whatItDoes: string;
  whyItMatters: string;
  howToUse: string;
  exampleOutput?: string;
  nextActionLabel?: string;
  onNextAction?: () => void;
}

export const ModuleBanner: React.FC<ModuleBannerProps> = ({
  title,
  whatItDoes,
  whyItMatters,
  howToUse,
  exampleOutput,
  nextActionLabel,
  onNextAction,
}) => {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <section className="mb-6 sm:mb-8 pb-5 sm:pb-6 border-b border-slate-200 dark:border-slate-800">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 break-words">
            {title}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
            {whatItDoes}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>{expanded ? 'Hide Module Guide' : 'How This Works'}</span>
          </button>

          {nextActionLabel && onNextAction && (
            <button
              type="button"
              onClick={onNextAction}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span>{nextActionLabel}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-200/70 dark:border-slate-800/70 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-slate-600 dark:text-slate-400">
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
              Why it matters
            </div>
            <p className="leading-relaxed">{whyItMatters}</p>
          </div>
          <div>
            <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
              How to use it
            </div>
            <p className="leading-relaxed">{howToUse}</p>
          </div>
          {exampleOutput && (
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-200 mb-1">
                Example output
              </div>
              <p className="leading-relaxed">{exampleOutput}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  isLoading,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {description}
            </p>
          </div>
        </div>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
