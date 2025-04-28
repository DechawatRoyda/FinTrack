<script setup>
const router = useRouter()
const loading = ref(false)
const error = ref(null)

const form = reactive({
  username: '',
  password: ''
})

async function handleLogin() {
  try {
    loading.value = true
    error.value = null
    
    // เปลี่ยนจาก /api/auth/login เป็น URL ของ backend จริงๆ
    const response = await $fetch(`http://localhost:5000/api/auth/login`, {
      method: 'POST',
      body: form,
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (response.data?.user?.role === 'admin') {
      // Store token
      localStorage.setItem('token', response.data.token)
      // Redirect to dashboard
      router.push('/dashboard')
    } else {
      error.value = 'Access denied. Admin privileges required.'
    }
  } catch (e) {
    console.error('Login error:', e)
    error.value = e.message || 'Invalid username or password'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  // ถ้ามี token อยู่แล้ว ให้ไปที่ dashboard
  const token = localStorage.getItem('token')
  if (token) {
    router.push('/dashboard')
  }
})
</script>


<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50">
    <div class="max-w-md w-full p-6 bg-white rounded-lg shadow-md">
      <h2 class="text-2xl font-bold text-center mb-6">Admin Login</h2>
      
      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <UInput
            v-model="form.username"
            label="Username"
            placeholder="Enter your username"
            required
          />
        </div>
        
        <div>
          <UInput
            v-model="form.password"
            type="password"
            label="Password"
            placeholder="Enter your password"
            required
          />
        </div>

        <div v-if="error" class="text-red-500 text-sm">
          {{ error }}
        </div>

        <UButton
          type="submit"
          color="primary"
          :loading="loading"
          block
        >
          Login
        </UButton>
      </form>
    </div>
  </div>
</template>