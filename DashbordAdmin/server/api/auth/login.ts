import { defineEventHandler, getHeaders, createError } from 'h3'

export default defineEventHandler(async (event) => {
  try {
    const headers = getHeaders(event)
    const token = headers.authorization?.replace('Bearer ', '')
    
    if (!token) {
      throw createError({
        statusCode: 401,
        message: 'No token provided'
      })
    }

    const response = await fetch('http://localhost:5000/api/auth/verify', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    })

    const data = await response.json()
    
    if (!response.ok) {
      throw createError({
        statusCode: response.status,
        message: data.message || 'Verification failed'
      })
    }

    return data
  } catch (error: any) {
    console.error('Verify error:', error)
    throw createError({
      statusCode: 401,
      message: error.message || 'Token verification failed'
    })
  }
})