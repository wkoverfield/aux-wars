import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import Toast from '../components/Toast';

/**
 * ToastContext provides global toast notification management
 * Allows any component to show toast messages with different types
 */
const ToastContext = createContext(null);

/**
 * ToastProvider component that manages toast notifications
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  /**
   * Shows a new toast notification
   * @param {string} message - The message to display
   * @param {string} type - The type of toast (success, error, warning, info)
   * @param {number} duration - How long to show the toast in milliseconds
   */
  const showToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = Date.now();
    const newToast = { id, message, type };
    
    setToasts(prev => [...prev, newToast]);

    // Auto-dismiss after duration
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(toast => toast.id !== id));
      }, duration);
    }
  }, []);

  /**
   * Manually closes a toast
   * @param {number} id - The toast ID to close
   */
  const closeToast = useCallback((id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-0 left-0 right-0 z-[200] pointer-events-none">
        <AnimatePresence mode="sync">
          {toasts.map((toast, index) => (
            <div
              key={toast.id}
              style={{ 
                position: 'absolute',
                top: `${20 + (index * 80)}px`,
                width: '100%',
                display: 'flex',
                justifyContent: 'center'
              }}
            >
              <Toast
                message={toast.message}
                type={toast.type}
                onClose={() => closeToast(toast.id)}
              />
            </div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Custom hook to use toast notifications
 * @returns {Object} Toast context with showToast function
 */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}