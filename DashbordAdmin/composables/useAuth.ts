import { ref, computed } from 'vue'
import type { User, AuthResponse } from '~/types'

interface FetchOptions {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}


export const useAuth = () => {
  const user = useState<User | null>('user', () => null)
  const token = useState<string | null>('token', () => null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const isAuthenticated = computed(() => !!token.value)

  const login = async (username: string, password: string): Promise<AuthResponse> => {
    try {
      loading.value = true
      error.value = null

      const response = await $fetch<AuthResponse>('http://localhost:/api/auth/login', {
        method: 'POST',
        body: { username, password }
      })

      if (response?.token) {
        token.value = response.token
        user.value = response.user
        localStorage.setItem('token', response.token)
        return response
      }

      throw new Error('Invalid response format')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Login failed'
      error.value = errorMessage
      throw new Error(errorMessage)
    } finally {
      loading.value = false
    }
  }

  const logout = () => {
    user.value = null
    token.value = null
    localStorage.removeItem('token')
    navigateTo('/login')
  }

  const checkAuth = async (): Promise<boolean> => {
    const storedToken = localStorage.getItem('token')
    if (!storedToken) return false

    try {
      const response = await $fetch<{ user: User }>('http://localhost:/api/auth/verify', {
        headers: {
          'Authorization': `Bearer ${storedToken}`
        }
      })
      
      if (response.user) {
        token.value = storedToken
        user.value = response.user
        return true
      }
      return false
    } catch (e) {
      console.error('Auth verification failed:', e)
      logout()
      return false
    }
  }

  // Add middleware to handle token in requests
  const fetchWithAuth = async (url: string, options: any = {}) => {
    const storedToken = token.value || localStorage.getItem('token')
    if (!storedToken) throw new Error('No token available')

    return await $fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${storedToken}`
      }
    })
  }

  return {
    user,
    token,
    loading,
    error,
    isAuthenticated,
    login,
    logout,
    checkAuth,
    fetchWithAuth
  }
}