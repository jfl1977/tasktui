import { createContext, useContext, type ReactNode } from 'react';

/** App-level UI actions shared by the views. */
export interface UI {
  /** Show a dialog. `render` receives a close function. */
  openModal: (render: (close: () => void) => ReactNode) => void;
  modalOpen: boolean;
  editing: boolean; // a text field has focus (EDIT mode)
}

export const UICtx = createContext<UI | null>(null);

export function useUI(): UI {
  const u = useContext(UICtx);
  if (!u) throw new Error('useUI outside provider');
  return u;
}
