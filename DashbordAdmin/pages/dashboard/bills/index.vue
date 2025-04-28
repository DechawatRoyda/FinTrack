<script setup>
const bills = ref([])
const loading = ref(true)
const error = ref(null)

// Table columns configuration
definePageMeta({
  layout: 'dashboard',
  // middleware: ['auth']  // เพิ่ม middleware auth
})
const columns = [
  {
    key: 'createdAt',
    label: 'Date',
    sortable: true
  },
  {
    key: 'billNumber',
    label: 'Bill Number'
  },
  {
    key: 'totalAmount',
    label: 'Amount'
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

// Fetch bills data
async function fetchBills() {
  try {
    loading.value = true
    const response = await $fetch(`http://localhost:5000/api/bills`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    })
    bills.value = response.data
  } catch (e) {
    error.value = 'Failed to load bills'
    console.error(e)
  } finally {
    loading.value = false
  }
}

// Load bills on component mount
onMounted(() => {
  fetchBills()
})
</script>

<template>
  <div class="p-4">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold">Bills Management</h1>
      
      <UButton
        color="primary"
        icon="i-heroicons-plus"
        @click="router.push('/dashboard/bills/new')"
      >
        Add New Bill
      </UButton>
    </div>

    <!-- Error Alert -->
    <UAlert
      v-if="error"
      type="danger"
      :title="error"
      class="mb-4"
    />

    <!-- Bills Table -->
    <UCard>
      <UTable
        :loading="loading"
        :columns="columns"
        :rows="bills"
      >
        <!-- Status Column -->
        <template #status-data="{ row }">
          <UBadge
            :color="row.status === 'paid' ? 'success' : 'warning'"
          >
            {{ row.status }}
          </UBadge>
        </template>

        <!-- Actions Column -->
        <template #actions-data="{ row }">
          <div class="flex gap-2">
            <UButton
              color="primary"
              variant="ghost"
              icon="i-heroicons-eye"
              :to="`/dashboard/bills/${row.id}`"
            />
            <UButton
              color="danger"
              variant="ghost"
              icon="i-heroicons-trash"
              @click="deleteBill(row.id)"
            />
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