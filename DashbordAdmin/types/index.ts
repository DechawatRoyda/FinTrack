export interface User {
    _id: string
    username: string
    name: string
    email: string
    role: 'admin' | 'user'
    isActive: boolean
  }
  
  export interface AuthResponse {
    token: string
    user: User
  }
  
  export interface Bill {
    _id: string
    billNumber: string
    totalAmount: number
    status: 'pending' | 'paid' | 'cancelled'
    createdAt: string
    updatedAt: string
  }
  
  export interface DashboardStats {
    totalUsers: number
    totalBills: number
    pendingBills: number
  }