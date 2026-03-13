import { useState, useEffect } from 'react';
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import { format, startOfWeek, addDays, isSameDay } from 'date-fns';
import { es } from 'date-fns/locale';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import { Plus, Calendar as CalendarIcon, Package } from 'lucide-react';
import api from '../services/api';

// Create a simplified Drag and Drop Calendar for MVP
// We will have columns for each day of the current week

const DraggableOrder = ({ order }) => {
    const { attributes, listeners, setNodeRef, transform } = useDraggable({
        id: order.id,
        data: order
    });

    // We need to use a hook to navigate, so we might need to push this component up or pass navigate down.
    // However, hooks can't be used conditionally inside map. 
    // Best practice: The parent passes a handler or we use Link (but we have dnd logic).
    // Let's use window.location or simple anchor for MVP to avoid Hook complexity inside callback if component is simple.
    // actually we can just use href for now or onClick with custom event.

    const style = transform ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 100,
        cursor: 'grabbing'
    } : undefined;

    return (
        <div ref={setNodeRef} style={style} {...listeners} {...attributes}
            className="bg-white p-2 mb-2 rounded border border-neutral-200 shadow-sm hover:shadow-md cursor-grab text-xs touch-none group relative">

            <div className="font-bold text-primary-700">{order.product.name}</div>
            <div className="flex justify-between mt-1 text-neutral-500">
                <span>{order.quantity} un</span>
                <span>{order.batch.batchCode.split('-').pop()}</span>
            </div>

            <div className="flex items-center justify-between mt-2">
                <div className={`text-[10px] uppercase font-bold px-1 rounded w-fit ${order.status === 'COMPLETED' ? 'bg-success-100 text-success-700' : 'bg-blue-50 text-blue-600'
                    }`}>
                    {order.status}
                </div>

                {/* EXECUTE BUTTON - Only for actionable orders */}
                <button
                    className="p-1 bg-green-50 text-green-600 rounded-full hover:bg-green-100 border border-green-200"
                    onPointerDown={(e) => {
                        // Prevent Drag
                        e.stopPropagation();
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        window.location.href = `/assembly-execution/${order.id}`;
                    }}
                    title="Ejecutar (Modo PLC)"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polygon points="10 8 16 12 10 16 10 8" /></svg>
                </button>
            </div>
        </div>
    );
};

const DayColumn = ({ date, orders }) => {
    const dateStr = date.toISOString();
    const { setNodeRef } = useDroppable({
        id: dateStr,
        data: { date: dateStr }
    });

    const isToday = isSameDay(date, new Date());

    return (
        <div ref={setNodeRef} className={`flex-1 min-w-[140px] border-r border-neutral-100 last:border-0 p-2 bg-neutral-50/50 ${isToday ? 'bg-blue-50/30' : ''}`}>
            <div className="text-center mb-3">
                <p className="text-xs text-neutral-500 uppercase">{format(date, 'EEE', { locale: es })}</p>
                <p className={`text-sm font-bold w-8 h-8 rounded-full flex items-center justify-center mx-auto ${isToday ? 'bg-primary-600 text-white' : 'text-neutral-700'}`}>
                    {format(date, 'd')}
                </p>
            </div>
            <div className="space-y-2 min-h-[300px]">
                {orders.map(order => <DraggableOrder key={order.id} order={order} />)}
            </div>
        </div>
    );
};

const Production = () => {
    const [orders, setOrders] = useState([]);
    const [currentDate, setCurrentDate] = useState(new Date());

    useEffect(() => {
        loadSchedule();
    }, [currentDate]);

    const loadSchedule = async () => {
        try {
            const start = startOfWeek(currentDate, { weekStartsOn: 1 });
            const end = addDays(start, 7);
            const res = await api.get(`/production/schedule?start=${start.toISOString()}&end=${end.toISOString()}`);
            setOrders(res.data.data);
        } catch (e) {
            console.error("Error loading schedule", e);
        }
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        if (!over) return;

        const orderId = active.id;
        const newDateStr = over.id;

        // Optimistic Update
        setOrders(prev => prev.map(o =>
            o.id === orderId ? { ...o, scheduledDate: newDateStr } : o
        ));

        // API Call
        try {
            await api.patch(`/production/${orderId}`, { scheduledDate: newDateStr });
        } catch (e) {
            console.error("Error moving order", e);
            loadSchedule(); // Revert on error
        }
    };

    const weekDays = Array.from({ length: 7 }).map((_, i) =>
        addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), i)
    );

    return (
        <div className="h-full flex flex-col">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <CalendarIcon className="text-primary-600" />
                        Plan de Producción
                    </h1>
                    <p className="text-sm text-neutral-500">
                        Semana del {format(weekDays[0], 'd MMM', { locale: es })} al {format(weekDays[6], 'd MMM', { locale: es })}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setCurrentDate(d => addDays(d, -7))}>Anterior</Button>
                    <Button variant="secondary" onClick={() => setCurrentDate(new Date())}>Hoy</Button>
                    <Button variant="secondary" onClick={() => setCurrentDate(d => addDays(d, 7))}>Siguiente</Button>
                    <Button icon={Plus} onClick={() => alert("Modal not implemented in MVP Step")}>Nueva Orden</Button>
                </div>
            </div>

            <Card className="flex-1 overflow-auto p-0 border-0 shadow-lg">
                <DndContext onDragEnd={handleDragEnd}>
                    <div className="flex h-full min-w-[800px]">
                        {weekDays.map(day => (
                            <DayColumn
                                key={day.toISOString()}
                                date={day}
                                orders={orders.filter(o => isSameDay(new Date(o.scheduledDate), day))}
                            />
                        ))}
                    </div>
                </DndContext>
            </Card>
        </div>
    );
};

export default Production;
