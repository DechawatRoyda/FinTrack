<script setup>
const { user, logout } = useAuth()
</script>

<template>
  <div class="min-h-screen bg-gray-100">
    <!-- Sidebar -->
    <aside class="fixed left-0 top-0 h-screen w-64 bg-white shadow-lg">
      <div class="p-4">
        <h1 class="text-xl font-bold">Admin Dashboard</h1>
      </div>
      <nav class="mt-4">
        <UVerticalNavigation
          :links="[
            {
              label: 'Dashboard',
              icon: 'i-heroicons-home',
              to: '/dashboard'
            },
            {
              label: 'Users',
              icon: 'i-heroicons-users',
              to: '/dashboard/users'
            },
            {
              label: 'Bills',
              icon: 'i-heroicons-document-text',
              to: '/dashboard/bills'
            }
          ]"
        />
      </nav>
    </aside>

    <!-- Main Content -->
    <div class="ml-64">
      <!-- Header -->
      <header class="bg-white shadow-sm">
        <div class="flex justify-between items-center px-6 py-4">
          <h2 class="text-xl">Welcome, {{ user?.name }}</h2>
          <UButton 
            color="gray" 
            variant="ghost"
            @click="logout"
          >
            Logout
          </UButton>
        </div>
      </header>
      
      <!-- Page Content -->
      <main class="p-6">
        <slot />
      </main>
    </div>
  </div>
</template>