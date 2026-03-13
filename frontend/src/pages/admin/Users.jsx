import { useState, useEffect } from 'react';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import api from '../../services/api';
import { Trash2, UserPlus, Pencil, Check, X } from 'lucide-react';

const Users = () => {
    const [users, setUsers] = useState([]);
    const [showModal, setShowModal] = useState(false);
    const [formData, setFormData] = useState({ name: '', email: '', password: '', role: 'DISTRIBUIDOR', nit: '' });
    const [editingNit, setEditingNit] = useState(null); // { userId, value }

    useEffect(() => { loadUsers(); }, []);

    const loadUsers = async () => {
        const res = await api.get('/admin/users');
        setUsers(res.data.data);
    };

    const handleDelete = async (id) => {
        if (confirm('¿Eliminar usuario?')) {
            await api.delete(`/admin/users/${id}`);
            loadUsers();
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            await api.post('/admin/users', formData);
            setShowModal(false);
            loadUsers();
            setFormData({ name: '', email: '', password: '', role: 'DISTRIBUIDOR', nit: '' });
        } catch (error) {
            alert('Error creando usuario');
        }
    };

    const handleSaveNit = async (userId) => {
        try {
            await api.patch(`/admin/users/${userId}`, { nit: editingNit.value });
            setEditingNit(null);
            loadUsers();
        } catch (error) {
            alert('Error actualizando NIT');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Administración de Usuarios</h1>
                <Button onClick={() => setShowModal(true)} icon={UserPlus}>Nuevo Usuario</Button>
            </div>

            <Card>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b">
                                <th className="p-3">Nombre</th>
                                <th className="p-3">Email</th>
                                <th className="p-3">Rol</th>
                                <th className="p-3">NIT / Cédula</th>
                                <th className="p-3">Fecha Registro</th>
                                <th className="p-3">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(user => (
                                <tr key={user.id} className="border-b hover:bg-neutral-50">
                                    <td className="p-3 font-medium">{user.name}</td>
                                    <td className="p-3 text-neutral-600">{user.email}</td>
                                    <td className="p-3"><span className="px-2 py-1 bg-neutral-100 rounded text-xs">{user.role}</span></td>
                                    <td className="p-3">
                                        {editingNit?.userId === user.id ? (
                                            <div className="flex items-center gap-1">
                                                <input
                                                    className="w-32 px-2 py-1 border rounded text-sm font-mono"
                                                    value={editingNit.value}
                                                    onChange={e => setEditingNit({ ...editingNit, value: e.target.value })}
                                                    placeholder="NIT"
                                                    autoFocus
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleSaveNit(user.id);
                                                        if (e.key === 'Escape') setEditingNit(null);
                                                    }}
                                                />
                                                <button onClick={() => handleSaveNit(user.id)}
                                                    className="text-green-600 hover:bg-green-50 p-1 rounded">
                                                    <Check size={16} />
                                                </button>
                                                <button onClick={() => setEditingNit(null)}
                                                    className="text-red-600 hover:bg-red-50 p-1 rounded">
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1">
                                                <span className={`text-sm font-mono ${user.nit ? 'text-neutral-700' : 'text-red-400 italic'}`}>
                                                    {user.nit || 'Sin NIT'}
                                                </span>
                                                <button
                                                    onClick={() => setEditingNit({ userId: user.id, value: user.nit || '' })}
                                                    className="text-neutral-400 hover:text-purple-600 hover:bg-purple-50 p-1 rounded"
                                                    title="Editar NIT"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    <td className="p-3 text-sm text-neutral-500">{new Date(user.createdAt).toLocaleDateString()}</td>
                                    <td className="p-3">
                                        <button onClick={() => handleDelete(user.id)} className="text-red-600 hover:bg-red-50 p-1 rounded">
                                            <Trash2 size={18} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            {showModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl p-6 w-full max-w-md">
                        <h2 className="text-lg font-bold mb-4">Crear Usuario</h2>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Nombre</label>
                                <input className="w-full p-2 border rounded" required
                                    value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Email</label>
                                <input className="w-full p-2 border rounded" type="email" required
                                    value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Contraseña</label>
                                <input className="w-full p-2 border rounded" type="password" required
                                    value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Rol</label>
                                <select className="w-full p-2 border rounded"
                                    value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })}>
                                    <option value="DISTRIBUIDOR">Distribuidor</option>
                                    <option value="ADMIN">Administrador</option>
                                    <option value="LOGISTICA">Logística</option>
                                    <option value="OPERARIO_PICKING">Operario Picking</option>
                                    <option value="PRODUCCION">Producción</option>
                                    <option value="CARTERA">Cartera</option>
                                    <option value="CALIDAD">Calidad</option>
                                    <option value="CONTABILIDAD">Contabilidad</option>
                                    <option value="COMERCIAL">Comercial</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">NIT / Cédula (para facturación Siigo)</label>
                                <input className="w-full p-2 border rounded" placeholder="Ej: 901749888"
                                    value={formData.nit} onChange={e => setFormData({ ...formData, nit: e.target.value })} />
                            </div>
                            <div className="flex gap-2 justify-end mt-6">
                                <Button variant="secondary" onClick={() => setShowModal(false)}>Cancelar</Button>
                                <Button type="submit">Guardar</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Users;
