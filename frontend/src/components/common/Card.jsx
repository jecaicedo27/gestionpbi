
const Card = ({ children, title, subtitle, hoverable = false, className = '' }) => {
    return (
        <div className={`bg-white rounded-xl shadow-sm border border-neutral-200 p-4 ${hoverable ? 'hover:shadow-md transition-shadow' : ''} ${className}`}>
            {title && (
                <div className="mb-4">
                    <h3 className="text-lg font-semibold text-neutral-900">{title}</h3>
                    {subtitle && <p className="text-xs text-neutral-500">{subtitle}</p>}
                </div>
            )}
            {children}
        </div>
    );
};

export default Card;
