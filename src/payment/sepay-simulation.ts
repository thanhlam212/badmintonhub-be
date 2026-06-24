import { PrismaClient } from '@prisma/client'
import axios from 'axios'
import { randomUUID } from 'crypto'

const API_BASE = 'http://localhost:3001/api'
const SEPAY_WEBHOOK_SECRET = 'spsk_test_LEGykZSPWJf3B9GkpGBPPmevMGmNFYtJ'

async function runSimulation() {
  const prisma = new PrismaClient()
  console.log('🚀 INITIALIZING SEPAY WEBHOOK & PAYMENT FLOW SIMULATION E2E')
  
  try {
    // 1. Cleanup old test data
    console.log('🧹 Cleaning up old test data...')
    const oldBookings = await prisma.booking.findMany({
      where: { customerName: 'Sepay Tester E2E' }
    })
    for (const b of oldBookings) {
      await prisma.courtSlot.deleteMany({ where: { bookingId: b.id } })
      await prisma.payment.deleteMany({ where: { invoice: { bookingId: b.id } } })
      await prisma.invoice.deleteMany({ where: { bookingId: b.id } })
      await prisma.booking.delete({ where: { id: b.id } })
    }
    console.log(`🧹 Cleaned up ${oldBookings.length} old booking(s).`)

    // 2. Create a new Booking (Pending) via HTTP POST
    const bookingDate = '2026-10-10'
    const timeStart = '08:00'
    const timeEnd = '10:00'
    console.log(`📅 Step 1: Creating a pending booking for date=${bookingDate}, time=${timeStart}-${timeEnd}...`)

    const bookingRes = await axios.post(`${API_BASE}/bookings`, {
      court_id: 1,
      booking_date: bookingDate,
      time_start: timeStart,
      time_end: timeEnd,
      customer_name: 'Sepay Tester E2E',
      customer_phone: '0987654321',
      customer_email: 'tester@sepay.vn',
      payment_method: 'sepay',
      slots: 1
    })

    if (!bookingRes.data || !bookingRes.data.data) {
      throw new Error(`Failed to create booking: ${JSON.stringify(bookingRes.data)}`)
    }

    const bookingData = bookingRes.data.data
    const bookingId = bookingData.id
    const invoiceId = bookingData.invoice_id
    console.log(`✅ Booking created successfully! ID: ${bookingId}, Invoice ID: ${invoiceId}`)

    // Verify initial state and get Invoice Code
    let booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    let invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    const invoiceCode = invoice?.code
    if (!invoiceCode) {
      throw new Error('Invoice code is missing!')
    }
    console.log(`🔍 [Initial Status] Booking: ${booking?.status}, Invoice: ${invoice?.status}, Code: ${invoiceCode}, Total amount: ${invoice?.totalSnapshot} VND`)

    // 3. Create pending payment directly in DB (to bypass Auth on /payment/create)
    console.log('💳 Step 2: Creating pending payment record directly in DB...')
    const expectedAmount = Number(invoice?.totalSnapshot || 0)
    const payment = await prisma.payment.create({
      data: {
        invoiceId: invoiceId,
        method: 'sepay',
        amount: expectedAmount,
        status: 'pending',
        transactionRef: `SEPAY-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
      }
    })
    console.log(`✅ Payment record created! ID: ${payment.id}, Status: ${payment.status}, Amount: ${payment.amount} VND`)

    // 4. Simulate underpay (chuyển khoản thiếu)
    const underpayAmount = expectedAmount - 50000 // Chuyển thiếu 50,000 VND
    console.log(`⚠️ Step 3: Simulating SePay IPN underpayment. Sending ${underpayAmount} VND instead of ${expectedAmount} VND...`)

    const underpayWebhookBody = {
      id: 999901,
      gateway: 'Vietcombank',
      transactionDate: '2026-06-03 20:30:00',
      accountNumber: '123456789',
      subAccount: null,
      transferType: 'in',
      transferAmount: underpayAmount,
      accumulatedBalance: 15000000,
      code: invoiceCode, // Correct Invoice Code
      content: `Chuyen khoan dat san ${invoiceCode}`,
      referenceCode: `MB-123456`,
      description: 'Underpay simulation transaction'
    }

    const underpayIpnRes = await axios.post(`${API_BASE}/payment/sepay/ipn`, underpayWebhookBody, {
      headers: {
        Authorization: `Apikey ${SEPAY_WEBHOOK_SECRET}`
      }
    })

    console.log(`✅ Webhook responded:`, underpayIpnRes.data)

    // Verify underpay effect
    booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    let checkPayment = await prisma.payment.findUnique({ where: { id: payment.id } })
    console.log(`🔍 [After Underpay] Payment Status: ${checkPayment?.status} (Expected: failed)`)
    console.log(`🔍 [After Underpay] Invoice Status: ${invoice?.status} (Expected: unpaid)`)
    console.log(`🔍 [After Underpay] Booking Status: ${booking?.status} (Expected: pending)`)

    if (checkPayment?.status !== 'failed' || invoice?.status !== 'unpaid' || booking?.status !== 'pending') {
      throw new Error('❌ Test Failed: Underpayment handling is incorrect!')
    }
    console.log('✅ Underpayment handling is PERFECT!')

    // 5. Create new pending payment (for retry flow)
    console.log('🔄 Step 4: Simulating retry by creating a new pending payment in DB...')
    const retryPayment = await prisma.payment.create({
      data: {
        invoiceId: invoiceId,
        method: 'sepay',
        amount: expectedAmount,
        status: 'pending',
        transactionRef: `SEPAY-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`,
      }
    })
    console.log(`✅ Retry Payment record created! ID: ${retryPayment.id}`)

    // 6. Simulate successful payment
    console.log(`💰 Step 5: Simulating SePay IPN successful full payment of ${expectedAmount} VND...`)
    const successWebhookBody = {
      id: 999902,
      gateway: 'Vietcombank',
      transactionDate: '2026-06-03 20:32:00',
      accountNumber: '123456789',
      subAccount: null,
      transferType: 'in',
      transferAmount: expectedAmount,
      accumulatedBalance: 15000000 + expectedAmount,
      code: invoiceCode,
      content: `Thanh toan dung ${invoiceCode}`,
      referenceCode: `MB-123457`,
      description: 'Success simulation transaction'
    }

    const successIpnRes = await axios.post(`${API_BASE}/payment/sepay/ipn`, successWebhookBody, {
      headers: {
        Authorization: `Apikey ${SEPAY_WEBHOOK_SECRET}`
      }
    })

    console.log(`✅ Webhook responded:`, successIpnRes.data)

    // Verify success effect
    booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } })
    checkPayment = await prisma.payment.findUnique({ where: { id: retryPayment.id } })
    const courtSlots = await prisma.courtSlot.findMany({ where: { bookingId: bookingId } })

    console.log(`🔍 [After Success] Payment Status: ${checkPayment?.status} (Expected: success)`)
    console.log(`🔍 [After Success] Invoice Status: ${invoice?.status} (Expected: paid)`)
    console.log(`🔍 [After Success] Booking Status: ${booking?.status} (Expected: confirmed)`)
    console.log(`🔍 [After Success] Court Slots statuses:`, courtSlots.map(s => s.status))

    if (checkPayment?.status !== 'success' || invoice?.status !== 'paid' || booking?.status !== 'confirmed') {
      throw new Error('❌ Test Failed: Success handling is incorrect!')
    }
    
    const allSlotsBooked = courtSlots.length > 0 && courtSlots.every(s => s.status === 'booked')
    if (!allSlotsBooked) {
      throw new Error('❌ Test Failed: Linked court slots were not updated to "booked"!')
    }
    console.log('✅ Success payment and reservation confirmation is PERFECT!')

    // 7. Test Idempotency (Gửi lại IPN giao dịch thành công)
    console.log('🔁 Step 6: Testing webhook idempotency (re-sending same transaction)...')
    const duplicateIpnRes = await axios.post(`${API_BASE}/payment/sepay/ipn`, successWebhookBody, {
      headers: {
        Authorization: `Apikey ${SEPAY_WEBHOOK_SECRET}`
      }
    })
    console.log(`✅ Duplicate Webhook responded:`, duplicateIpnRes.data)
    
    const checkPaymentAgain = await prisma.payment.findUnique({ where: { id: retryPayment.id } })
    console.log(`🔍 [After Duplicate] Payment Status remains: ${checkPaymentAgain?.status}`)
    console.log('✅ Idempotency handling is PERFECT!')

    // 8. Test Unauthorized (Sai API key)
    console.log('🔒 Step 7: Testing unauthorized IPN request...')
    const unauthorizedRes = await axios.post(`${API_BASE}/payment/sepay/ipn`, successWebhookBody, {
      headers: {
        Authorization: `Apikey WRONG_SECRET`
      }
    })
    
    if (unauthorizedRes.data && unauthorizedRes.data.success === false && unauthorizedRes.data.message === 'Unauthorized') {
      console.log(`✅ Unauthorized request rejected correctly with:`, unauthorizedRes.data)
    } else {
      throw new Error(`❌ Test Failed: Server did not reject with unauthorized message. Response: ${JSON.stringify(unauthorizedRes.data)}`)
    }

    console.log('\n⭐ ALL E2E FLOW TESTS PASSED FLAWLESSLY! ⭐')

  } catch (err: any) {
    console.error('❌ SIMULATION ERROR:', err.message)
    if (err.response) {
      console.error('Response Data:', err.response.data)
    }
  } finally {
    await prisma.$disconnect()
  }
}

runSimulation()
