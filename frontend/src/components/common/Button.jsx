
import { Loader2 } from 'lucide-react';

const Button = ({ children, variant = 'primary', size = 'md', icon: Icon, isLoading, disabled, className = '', ...props }) => {
    const variants = {
        primary: 'bg-primary-600 hover:bg-primary-700 text-white shadow-sm',
        secondary: 'bg-white hover:bg-neutral-50 text-neutral-700 border border-neutral-300',
        danger: 'bg-danger-500 hover:bg-danger-600 text-white',
        ghost: 'hover:bg-neutral-100 text-neutral-700',
    };

    const sizes = {
        sm: 'px-3 py-1.5 text-xs gap-1.5',
        md: 'px-4 py-2 text-sm gap-2',
        lg: 'px-5 py-2.5 text-base gap-2.5',
    };

    return (
        <button
            className={`inline-flex items-center justify-center font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
            disabled={isLoading || disabled}
            {...props}
        >
            {isLoading ? <Loader2 size={size === 'sm' ? 14 : 18} className="animate-spin" /> : Icon && <Icon size={size === 'sm' ? 16 : 18} />}
            {children}
        </button>
    );
};

export default Button;
