<template>
    <aside class="fixed left-0 top-0 h-screen w-64 bg-white shadow-lg">
      <div class="p-4">
        <h1 class="text-xl font-bold">Admin Dashboard</h1>
      </div>
  
      <nav class="mt-8">
        <UVerticalNavigation
          :items="[
            {
              label: 'Overview',
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
            },
            {
              label: 'Settings',
              icon: 'i-heroicons-cog',
              to: '/dashboard/settings'
            }
          ]"
        />
      </nav>
    </aside>
  </template>