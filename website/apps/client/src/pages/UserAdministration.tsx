import { useEffect, useState } from 'react';
import { adminApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import { useNavigate } from 'react-router-dom';

interface UserData {
  id: string;
  email: string;
  displayName: string | null;
  githubId: string | null;
  isAdmin: boolean;
  createdAt: string;
}

interface AdminStats {
  totalUsers: number;
  totalAdmins: number;
  activeSessions: number;
}

interface UserFormData {
  email: string;
  displayName: string;
  password: string;
  isAdmin: boolean;
}

export default function UserAdministration() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserData[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [formData, setFormData] = useState<UserFormData>({
    email: '',
    displayName: '',
    password: '',
    isAdmin: false,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  // Redirect if not admin
  useEffect(() => {
    if (!user?.isAdmin) {
      navigate('/');
    }
  }, [user, navigate]);

  useEffect(() => {
    loadUsers();
    loadStats();
  }, []);

  const loadUsers = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await adminApi.listUsers();
      setUsers(response.data);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const response = await adminApi.getStats();
      setStats(response.data);
    } catch (err: any) {
      console.error('Failed to load stats:', err);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);

    try {
      await adminApi.createUser({
        email: formData.email,
        displayName: formData.displayName || undefined,
        password: formData.password,
        isAdmin: formData.isAdmin,
      });

      // Reset form and close modal
      setFormData({ email: '', displayName: '', password: '', isAdmin: false });
      setShowCreateModal(false);

      // Reload users
      await loadUsers();
      await loadStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create user');
    } finally {
      setFormLoading(false);
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setFormError(null);
    setFormLoading(true);

    try {
      const updateData: any = {
        email: formData.email,
        displayName: formData.displayName || null,
        isAdmin: formData.isAdmin,
      };

      // Only include password if it's been changed
      if (formData.password) {
        updateData.password = formData.password;
      }

      await adminApi.updateUser(editingUser.id, updateData);

      // Reset form and close modal
      setFormData({ email: '', displayName: '', password: '', isAdmin: false });
      setEditingUser(null);

      // Reload users
      await loadUsers();
      await loadStats();
    } catch (err: any) {
      setFormError(err.message || 'Failed to update user');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    try {
      await adminApi.deleteUser(userId);
      await loadUsers();
      await loadStats();
    } catch (err: any) {
      alert(err.message || 'Failed to delete user');
    }
  };

  const handleImpersonate = async (userId: string) => {
    if (!confirm('Are you sure you want to impersonate this user? You will be logged in as them.')) {
      return;
    }

    try {
      await adminApi.impersonateUser(userId);
      // Reload the page to update the session
      window.location.href = '/';
    } catch (err: any) {
      alert(err.message || 'Failed to impersonate user');
    }
  };

  const openEditModal = (userData: UserData) => {
    setEditingUser(userData);
    setFormData({
      email: userData.email,
      displayName: userData.displayName || '',
      password: '', // Don't populate password
      isAdmin: userData.isAdmin,
    });
    setFormError(null);
  };

  const closeModal = () => {
    setShowCreateModal(false);
    setEditingUser(null);
    setFormData({ email: '', displayName: '', password: '', isAdmin: false });
    setFormError(null);
  };

  if (!user?.isAdmin) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-base-content mb-2">👑 User Administration</h1>
        <p className="text-base-content/70">Manage users, permissions, and view system statistics</p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-base-200 rounded-lg p-6 shadow">
            <div className="text-sm text-base-content/70 mb-1">Total Users</div>
            <div className="text-3xl font-bold text-base-content">{stats.totalUsers}</div>
          </div>
          <div className="bg-base-200 rounded-lg p-6 shadow">
            <div className="text-sm text-base-content/70 mb-1">Administrators</div>
            <div className="text-3xl font-bold text-primary">{stats.totalAdmins}</div>
          </div>
          <div className="bg-base-200 rounded-lg p-6 shadow">
            <div className="text-sm text-base-content/70 mb-1">Active Sessions</div>
            <div className="text-3xl font-bold text-success">{stats.activeSessions}</div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mb-6">
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary"
        >
          ➕ Create New User
        </button>
      </div>

      {/* Users Table */}
      {loading ? (
        <div className="text-center py-12">
          <div className="loading loading-spinner loading-lg"></div>
          <p className="mt-4 text-base-content/70">Loading users...</p>
        </div>
      ) : error ? (
        <div className="alert alert-error">
          <span>{error}</span>
        </div>
      ) : (
        <div className="bg-base-200 rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table table-zebra w-full">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Display Name</th>
                  <th>Role</th>
                  <th>GitHub</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((userData) => (
                  <tr key={userData.id}>
                    <td>
                      <div className="font-medium">{userData.email}</div>
                      {user?.id === userData.id && (
                        <span className="badge badge-sm badge-info mt-1">You</span>
                      )}
                    </td>
                    <td>{userData.displayName || <span className="text-base-content/50">—</span>}</td>
                    <td>
                      {userData.isAdmin ? (
                        <span className="badge badge-primary">Admin</span>
                      ) : (
                        <span className="badge badge-ghost">User</span>
                      )}
                    </td>
                    <td>
                      {userData.githubId ? (
                        <span className="badge badge-success">Connected</span>
                      ) : (
                        <span className="badge badge-ghost">Not Connected</span>
                      )}
                    </td>
                    <td className="text-sm">
                      {new Date(userData.createdAt).toLocaleDateString()}
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEditModal(userData)}
                          className="btn btn-sm btn-ghost"
                          title="Edit user"
                        >
                          ✏️
                        </button>
                        {user?.id !== userData.id && (
                          <>
                            <button
                              onClick={() => handleImpersonate(userData.id)}
                              className="btn btn-sm btn-ghost"
                              title="Impersonate user"
                            >
                              🎭
                            </button>
                            <button
                              onClick={() => handleDeleteUser(userData.id)}
                              className="btn btn-sm btn-ghost text-error"
                              title="Delete user"
                            >
                              🗑️
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create/Edit User Modal */}
      {(showCreateModal || editingUser) && (
        <div className="modal modal-open">
          <div className="modal-box">
            <h3 className="font-bold text-lg mb-4">
              {editingUser ? 'Edit User' : 'Create New User'}
            </h3>

            <form onSubmit={editingUser ? handleUpdateUser : handleCreateUser}>
              {formError && (
                <div className="alert alert-error mb-4">
                  <span>{formError}</span>
                </div>
              )}

              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">Email</span>
                </label>
                <input
                  type="email"
                  className="input input-bordered"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  required
                />
              </div>

              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">Display Name</span>
                </label>
                <input
                  type="text"
                  className="input input-bordered"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                />
              </div>

              <div className="form-control mb-4">
                <label className="label">
                  <span className="label-text">
                    Password {editingUser && '(leave blank to keep unchanged)'}
                  </span>
                </label>
                <input
                  type="password"
                  className="input input-bordered"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required={!editingUser}
                />
              </div>

              <div className="form-control mb-6">
                <label className="label cursor-pointer justify-start gap-3">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary"
                    checked={formData.isAdmin}
                    onChange={(e) => setFormData({ ...formData, isAdmin: e.target.checked })}
                    disabled={editingUser?.id === user?.id}
                  />
                  <span className="label-text">Administrator</span>
                </label>
                {editingUser?.id === user?.id && (
                  <p className="text-xs text-base-content/60 mt-1 ml-8">
                    You cannot change your own admin status
                  </p>
                )}
              </div>

              <div className="modal-action">
                <button
                  type="button"
                  onClick={closeModal}
                  className="btn btn-ghost"
                  disabled={formLoading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={formLoading}
                >
                  {formLoading ? (
                    <span className="loading loading-spinner"></span>
                  ) : editingUser ? (
                    'Update User'
                  ) : (
                    'Create User'
                  )}
                </button>
              </div>
            </form>
          </div>
          <div className="modal-backdrop" onClick={closeModal}></div>
        </div>
      )}
    </div>
  );
}
