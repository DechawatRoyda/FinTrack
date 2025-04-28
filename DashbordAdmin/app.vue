<script setup>
const { isAuthenticated, checkAuth } = useAuth()

// Check authentication on app mount
onMounted(async () => {
  await checkAuth()
})
</script>

<template>
  <div>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </div>
</template>