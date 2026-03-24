import React from 'react';
import { getSampleEntityFieldConfig } from '../microLabConfig';

const MicroInternalSampleTypeFields = ({
    entityType = 'OTRO',
    data = {},
    onChange,
    disabled = false
}) => {
    const fields = getSampleEntityFieldConfig(entityType);

    const handleChange = (fieldName, value) => {
        if (typeof onChange !== 'function') return;
        onChange(previous => ({
            ...previous,
            [fieldName]: value
        }));
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {fields.map(field => (
                <div key={field.name} className={field.type === 'textarea' ? 'md:col-span-2 xl:col-span-3' : ''}>
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
                        {field.label}{field.required ? ' *' : ''}
                    </label>
                    {field.type === 'textarea' ? (
                        <textarea
                            value={data?.[field.name] ?? ''}
                            onChange={event => handleChange(field.name, event.target.value)}
                            disabled={disabled}
                            rows={3}
                            placeholder={field.placeholder || ''}
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 resize-none ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    ) : (
                        <input
                            type={field.type || 'text'}
                            inputMode={field.type === 'number' ? 'decimal' : undefined}
                            value={data?.[field.name] ?? ''}
                            onChange={event => handleChange(field.name, event.target.value)}
                            disabled={disabled}
                            placeholder={field.placeholder || ''}
                            className={`w-full rounded-2xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 ${disabled ? 'bg-gray-100 cursor-not-allowed opacity-75' : ''}`}
                        />
                    )}
                </div>
            ))}
        </div>
    );
};

export default MicroInternalSampleTypeFields;
