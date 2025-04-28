<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { DashboardStats } from '~/types'

const router = useRouter()

definePageMeta({
  layout: 'dashboard',
  // middleware: ['auth']  // เพิ่ม middleware auth
})

const stats = ref<DashboardStats>({
  users: 0,
  bills: 0,
  pendingBills: 0
})

const loading = ref(false)
const error = ref<string | null>(null)

// เช็ค token ก่อนโหลดข้อมูล
const checkAuthAndFetchStats = async () => {
  const token = localStorage.getItem('token')
  if (!token) {
    router.push('/login')
    return
  }

  try {
    loading.value = true
    const response = await $fetch('http://localhost:5000/api/admin/stats', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })
    stats.value = response.data
  } catch (err) {
    console.error('Failed to fetch stats:', err)
    error.value = 'Failed to load stats'
    // ถ้า token หมดอายุหรือไม่ถูกต้อง ให้กลับไปหน้า login
    if (err.status === 401) {
      localStorage.removeItem('token')
      router.push('/login')
    }
  } finally {
    loading.value = false
  }
}

// เรียกใช้ฟังก์ชันตอนโหลดหน้า
onMounted(() => {
  checkAuthAndFetchStats()
})
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-6">Dashboard Overview</h1>

    <!-- แสดง Loading state -->
    <div v-if="loading" class="flex justify-center items-center py-8">
      <ULoader />
    </div>

    <!-- แสดง Error message ถ้ามี -->
    <UAlert v-if="error" type="danger" :title="error" class="mb-4" />

    <!-- แสดงข้อมูล Stats -->
    <div v-if="!loading && !error" class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <UCard>
        <template #header>Total Users</template>
        <div class="text-2xl font-bold">{{ stats.users }}</div>
      </UCard>

      <UCard>
        <template #header>Total Bills</template>
        <div class="text-2xl font-bold">{{ stats.bills }}</div>
      </UCard>

      <UCard>
        <template #header>Pending Bills</template>
        <div class="text-2xl font-bold">{{ stats.pendingBills }}</div>
      </UCard>
    </div>
  </div>
</template>