<script setup>
const users = ref([])
const loading = ref(true)
const error = ref(null)

// Table columns configuration

definePageMeta({
  layout: 'dashboard',
  // middleware: ['auth']  // เพิ่ม middleware auth
})
const columns = [
  {
    key: 'username',
    label: 'Username',
    sortable: true
  },
  {
    key: 'name',
    label: 'Full Name'
  },
  {
    key: 'email',
    label: 'Email'
  },
  {
    key: 'role',
    label: 'Role'
  },
  {
    key: 'status',
    label: 'Status'
  },
  {
    key: 'actions',
    label: 'Actions'
  }
]

// Fetch users data
async function fetchUsers() {
  try {
    loading.value = true
    const response = await $fetch('http://localhost:5000/api/admin/users', {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    })
    users.value = response.data
  } catch (e) {
    error.value = 'Failed to load users'
    console.error(e)
  } finally {
    loading.value = false
  }
}

// Toggle user status
async function toggleUserStatus(userId, currentStatus) {
  try {
    await $fetch(`http://localhost:5000/api/admin/users/${userId}/status`, {
      method: 'PATCH',
      body: { isActive: !currentStatus },
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    })
    await fetchUsers()
  } catch (e) {
    error.value = 'Failed to update user status'
  }
}

// Delete user
async function deleteUser(userId) {
  if (!confirm('Are you sure you want to delete this user?')) return

  try {
    await $fetch(`http://localhost5000:/api/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    })
    await fetchUsers()
  } catch (e) {
    error.value = 'Failed to delete user'
  }
}

// Load users on component mount
onMounted(() => {
  fetchUsers()
})
</script>

<template>
  <div class="p-4">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold">Users Management</h1>

      <UButton color="primary" icon="i-heroicons-plus" @click="router.push('/dashboard/users/new')">
        Add New User
      </UButton>
    </div>

    <!-- Error Alert -->
    <UAlert v-if="error" type="danger" :title="error" class="mb-4" />

    <!-- Users Table -->
    <UCard>
      <UTable :loading="loading" :columns="columns" :rows="users">
        <!-- Role Column -->
        <template #role-data="{ row }">
          <UBadge variant="solid" :class="[
            row.role === 'admin'
              ? 'bg-blue-500 hover:bg-blue-600'
              : 'bg-gray-500 hover:bg-gray-600',
            'text-white'
          ]">
            {{ row.role }}
          </UBadge>
        </template>

        <!-- Status Column -->
        <template #status-data="{ row }">
          <UBadge variant="solid" :class="[
            'cursor-pointer transition-all duration-200',
            row.isActive
              ? 'bg-green-500 hover:bg-green-600'
              : 'bg-red-500 hover:bg-red-600',
            'text-white'
          ]" @click="toggleUserStatus(row._id, row.isActive)">
            {{ row.isActive ? 'Active' : 'Inactive' }}
          </UBadge>
        </template>

        <!-- Actions Column -->
        <template #actions-data="{ row }">
          <div class="flex gap-2">
            <!-- Edit Button -->
            <UButton variant="ghost" :class="[
              'text-blue-500 hover:text-blue-600',
              'hover:bg-blue-50'
            ]" icon="i-heroicons-pencil" :to="`/dashboard/users/${row._id}/edit`" />

            <!-- Delete Button -->
            <UButton variant="ghost" :class="[
              'text-red-500 hover:text-red-600',
              'hover:bg-red-50'
            ]" icon="i-heroicons-trash" @click="deleteUser(row._id)" />
          </div>
        </template>
      </UTable>
    </UCard>
  </div>
</template>

<style scoped>
.p-4 {
  padding: 1rem;
}
</style>