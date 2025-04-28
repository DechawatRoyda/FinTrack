<script setup>
const router = useRouter()
const { isAuthenticated } = useAuth()

// Redirect to dashboard if authenticated, otherwise to login
onMounted(() => {
  if (isAuthenticated.value) {
    router.push('/dashboard')
  } else {
    router.push('/login')
  }
})
</script>

<template>
  <div class="flex items-center justify-center min-h-screen">
    <ULoading />
  </div>
</template>