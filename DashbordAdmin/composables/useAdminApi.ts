import type { User, Bill, DashboardStats } from '~/types'

export const useAdminApi = () => {
  const config = useRuntimeConfig()
  const baseURL = config.public.apiBase

  const getHeaders = () => ({
    'Authorization': `Bearer ${localStorage.getItem('token')}`,
    'Content-Type': 'application/json'
  })

  return {
    // Users API
    async getUsers() {
      return await useFetch<{ data: User[] }>(`http://localhost:/api/admin/users`, {
        baseURL,
        headers: getHeaders()
      })
    },

    async getUserById(id: string) {
      return await useFetch<{ data: User }>(`http://localhost:/api/admin/users/${id}`, {
        baseURL,
        headers: getHeaders()
      })
    },

    async updateUser(id: string, userData: Partial<User>) {
      return await useFetch<{ data: User }>(`http://localhost:/api/admin/users/${id}`, {
        method: 'PUT',
        baseURL,
        headers: getHeaders(),
        body: userData
      })
    },

    async deleteUser(id: string) {
      return await useFetch<{ success: boolean }>(`http://localhost:/api/admin/users/${id}`, {
        method: 'DELETE',
        baseURL,
        headers: getHeaders()
      })
    },

    // Bills API
    async getBills() {
      return await useFetch<{ data: Bill[] }>(`http://localhost:/api/admin/bills`, {
        baseURL,
        headers: getHeaders()
      })
    },

    async getBillById(id: string) {
      return await useFetch<{ data: Bill }>(`http://localhost:/api/admin/bills/${id}`, {
        baseURL,
        headers: getHeaders()
      })
    },

    async updateBillStatus(id: string, status: Bill['status']) {
      return await useFetch<{ data: Bill }>(`http://localhost:/api/admin/bills/${id}/status`, {
        method: 'PATCH',
        baseURL,
        headers: getHeaders(),
        body: { status }
      })
    },

    // Dashboard Stats
    async getStats() {
      return await useFetch<{ data: DashboardStats }>(`http://localhost:/api/admin/stats`, {
        baseURL,
        headers: getHeaders()
      })
    }
  }
}