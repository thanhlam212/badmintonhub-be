// prisma/seed.ts
// Chạy: npx prisma db seed

import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { Gender } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Bắt đầu seed dữ liệu...')

  // ═══════════════════════════════════════════════
  // 1. BRANCHES — Chi nhánh
  // ═══════════════════════════════════════════════
  console.log('📍 Tạo chi nhánh...')

  const branch1 = await prisma.branch.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'BadmintonHub Cầu Giấy',
      address: '123 Xuân Thủy, Cầu Giấy, Hà Nội',
      lat: 21.0379,
      lng: 105.7826,
      phone: '024 1234 5678',
      email: 'caugiay@badmintonhub.vn',
      isActive: true,
    },
  })

  const branch2 = await prisma.branch.upsert({
    where: { id: 2 },
    update: {},
    create: {
      id: 2,
      name: 'BadmintonHub Thanh Xuân',
      address: '456 Nguyễn Trãi, Thanh Xuân, Hà Nội',
      lat: 20.9952,
      lng: 105.8041,
      phone: '024 2345 6789',
      email: 'thanhxuan@badmintonhub.vn',
      isActive: true,
    },
  })

  const branch3 = await prisma.branch.upsert({
    where: { id: 3 },
    update: {},
    create: {
      id: 3,
      name: 'BadmintonHub Long Biên',
      address: '789 Ngô Gia Tự, Long Biên, Hà Nội',
      lat: 21.0469,
      lng: 105.8829,
      phone: '024 3456 7890',
      email: 'longbien@badmintonhub.vn',
      isActive: true,
    },
  })

  console.log('✅ Đã tạo 3 chi nhánh')

  // ═══════════════════════════════════════════════
  // 2. COURTS — Sân cầu lông
  // ═══════════════════════════════════════════════
  console.log('🏸 Tạo sân cầu lông...')

  // ── Chi nhánh Cầu Giấy ──────────────────────
  const court1 = await prisma.court.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'Sân A1 - Standard',
      branchId: branch1.id,
      type: 'standard',
      indoor: true,
      price: 120000,
      rating: 4.5,
      reviewsCount: 28,
      available: true,
      description: 'Sân tiêu chuẩn, phù hợp cho mọi trình độ. Sàn gỗ cao cấp, đèn LED đầy đủ ánh sáng.',
      hours: '06:00 - 22:00',
    },
  })

  await prisma.courtAmenity.createMany({
    data: [
      { courtId: court1.id, amenity: 'Điều hòa' },
      { courtId: court1.id, amenity: 'Đèn LED' },
      { courtId: court1.id, amenity: 'Sàn gỗ' },
      { courtId: court1.id, amenity: 'Phòng thay đồ' },
    ],
    skipDuplicates: true,
  })

  const court2 = await prisma.court.upsert({
    where: { id: 2 },
    update: {},
    create: {
      id: 2,
      name: 'Sân A2 - Premium',
      branchId: branch1.id,
      type: 'premium',
      indoor: true,
      price: 180000,
      rating: 4.8,
      reviewsCount: 45,
      available: true,
      description: 'Sân Premium với sàn PU chuyên nghiệp, hệ thống đèn LED cao cấp và điều hòa 2 chiều.',
      hours: '06:00 - 22:00',
    },
  })

  await prisma.courtAmenity.createMany({
    data: [
      { courtId: court2.id, amenity: 'Điều hòa' },
      { courtId: court2.id, amenity: 'Đèn LED' },
      { courtId: court2.id, amenity: 'Sàn PU' },
      { courtId: court2.id, amenity: 'Phòng thay đồ' },
      { courtId: court2.id, amenity: 'Wi-Fi' },
      { courtId: court2.id, amenity: 'Camera' },
    ],
    skipDuplicates: true,
  })

  const court3 = await prisma.court.upsert({
    where: { id: 3 },
    update: {},
    create: {
      id: 3,
      name: 'Sân VIP - Olympus',
      branchId: branch1.id,
      type: 'vip',
      indoor: true,
      price: 280000,
      rating: 4.9,
      reviewsCount: 19,
      available: true,
      description: 'Sân VIP đẳng cấp với sàn gỗ nhập khẩu, phòng chờ riêng và dịch vụ khăn lạnh.',
      hours: '06:00 - 22:00',
    },
  })

  await prisma.courtAmenity.createMany({
    data: [
      { courtId: court3.id, amenity: 'Điều hòa' },
      { courtId: court3.id, amenity: 'Đèn LED' },
      { courtId: court3.id, amenity: 'Sàn gỗ nhập khẩu' },
      { courtId: court3.id, amenity: 'Phòng chờ VIP' },
      { courtId: court3.id, amenity: 'Wi-Fi' },
      { courtId: court3.id, amenity: 'Khăn lạnh' },
      { courtId: court3.id, amenity: 'Nước uống' },
    ],
    skipDuplicates: true,
  })

  // ── Chi nhánh Thanh Xuân ─────────────────────
  const court4 = await prisma.court.upsert({
    where: { id: 4 },
    update: {},
    create: {
      id: 4,
      name: 'Sân B1 - Standard',
      branchId: branch2.id,
      type: 'standard',
      indoor: true,
      price: 110000,
      rating: 4.3,
      reviewsCount: 32,
      available: true,
      description: 'Sân tiêu chuẩn thoáng mát, vị trí thuận tiện tại Thanh Xuân.',
      hours: '05:30 - 22:00',
    },
  })

  await prisma.courtAmenity.createMany({
    data: [
      { courtId: court4.id, amenity: 'Đèn LED' },
      { courtId: court4.id, amenity: 'Sàn gỗ' },
      { courtId: court4.id, amenity: 'Phòng thay đồ' },
    ],
    skipDuplicates: true,
  })

  const court5 = await prisma.court.upsert({
    where: { id: 5 },
    update: {},
    create: {
      id: 5,
      name: 'Sân B2 - Premium',
      branchId: branch2.id,
      type: 'premium',
      indoor: false,
      price: 150000,
      rating: 4.6,
      reviewsCount: 27,
      available: true,
      description: 'Sân ngoài trời Premium với mái che chống nắng, phù hợp buổi sáng và chiều mát.',
      hours: '05:30 - 21:00',
    },
  })

  await prisma.courtAmenity.createMany({
    data: [
      { courtId: court5.id, amenity: 'Mái che' },
      { courtId: court5.id, amenity: 'Đèn LED' },
      { courtId: court5.id, amenity: 'Phòng thay đồ' },
      { courtId: court5.id, amenity: 'Wi-Fi' },
    ],
    skipDuplicates: true,
  })

  // ── Chi nhánh Long Biên ──────────────────────
  const court6 = await prisma.court.upsert({
    where: { id: 6 },
    update: {},
    create: {
      id: 6,
      name: 'Sân C1 - Standard',
      branchId: branch3.id,
      type: 'standard',
      indoor: true,
      price: 100000,
      rating: 4.2,
      reviewsCount: 15,
      available: true,
      description: 'Sân tiêu chuẩn giá tốt tại Long Biên, gần cầu Long Biên.',
      hours: '06:00 - 22:00',
    },
  })

  await prisma.courtAmenity.createMany({
    data: [
      { courtId: court6.id, amenity: 'Điều hòa' },
      { courtId: court6.id, amenity: 'Đèn LED' },
      { courtId: court6.id, amenity: 'Sàn gỗ' },
    ],
    skipDuplicates: true,
  })

  const court7 = await prisma.court.upsert({
    where: { id: 7 },
    update: {},
    create: {
      id: 7,
      name: 'Sân C2 - Premium',
      branchId: branch3.id,
      type: 'premium',
      indoor: true,
      price: 160000,
      rating: 4.7,
      reviewsCount: 22,
      available: true,
      description: 'Sân Premium mới khai trương, trang thiết bị hiện đại nhất hệ thống.',
      hours: '06:00 - 22:00',
    },
  })

  await prisma.courtAmenity.createMany({
    data: [
      { courtId: court7.id, amenity: 'Điều hòa' },
      { courtId: court7.id, amenity: 'Đèn LED' },
      { courtId: court7.id, amenity: 'Sàn PU' },
      { courtId: court7.id, amenity: 'Phòng thay đồ' },
      { courtId: court7.id, amenity: 'Wi-Fi' },
      { courtId: court7.id, amenity: 'Camera' },
    ],
    skipDuplicates: true,
  })

  console.log('✅ Đã tạo 7 sân cầu lông')

  // ═══════════════════════════════════════════════
  // WAREHOUSES
  // ═══════════════════════════════════════════════
  await prisma.warehouse.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: 'Kho Cầu Giấy',
      branchId: branch1.id,
      isActive: true,
    },
  })

  await prisma.warehouse.upsert({
    where: { id: 2 },
    update: {},
    create: {
      id: 2,
      name: 'Kho Thanh Xuân',
      branchId: branch2.id,
      isActive: true,
    },
  })

  await prisma.warehouse.upsert({
    where: { id: 3 },
    update: {},
    create: {
      id: 3,
      name: 'Kho Long Biên',
      branchId: branch3.id,
      isActive: true,
    },
  })
  console.log('✅ 3 kho hàng')

  // ═══════════════════════════════════════════════
  // 3. ADMIN USER — Tài khoản quản trị
  // ═══════════════════════════════════════════════
  console.log('👤 Tạo tài khoản admin...')

  const passwordHash = await bcrypt.hash('Admin@123', 10)

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash,
      fullName: 'Quản trị viên',
      email: 'admin@badmintonhub.vn',
      phone: '0901111111',
      role: 'admin',
    },
  })

  await prisma.user.upsert({
    where: { username: 'employee1' },
    update: { warehouseId: 1 },
    create: {
      username: 'employee1',
      passwordHash: await bcrypt.hash('Employee@123', 10),
      fullName: 'Nhân viên Cầu Giấy',
      email: 'nv1@badmintonhub.vn',
      phone: '0902222222',
      role: 'employee',
    },
  })

  console.log('✅ Đã tạo tài khoản admin và employee')

  // ═══════════════════════════════════════════════
  // 4. PRODUCTS — 14 sản phẩm
  // ═══════════════════════════════════════════════
  console.log('📦 Tạo sản phẩm...')

  const products = [
    // ── Vợt cầu lông ──────────────────────────
    {
      sku: 'VOT-YNX-001', name: 'Vợt Yonex Astrox 88D Pro', brand: 'Yonex', category: 'Vợt cầu lông',
      price: 3500000, originalPrice: 4200000, rating: 4.8, reviewsCount: 124, gender: 'nam',
      description: 'Vợt tấn công đỉnh cao dòng Astrox, khung carbon Nanomesh Neo siêu nhẹ, cứng cáp.',
      features: ['Tấn công mạnh', 'Khung carbon Nanomesh', 'Trọng lượng 4U (83g)', 'Cân bằng đầu vợt'],
      specs: { 'Trọng lượng': '4U (83g)', 'Độ cứng': 'Cứng', 'Chiều dài': '675mm', 'Chất liệu': 'Carbon + Nanomesh' },
      badges: ['Bán chạy', 'Tấn công'],
    },
    {
      sku: 'VOT-YNX-002', name: 'Vợt Yonex Nanoflare 700', brand: 'Yonex', category: 'Vợt cầu lông',
      price: 2900000, originalPrice: 3500000, rating: 4.7, reviewsCount: 89, gender: null,
      description: 'Vợt tốc độ cao dòng Nanoflare, thiết kế cho lối chơi lưới linh hoạt.',
      features: ['Tốc độ cao', 'Linh hoạt', 'Trọng lượng 5U (78g)', 'Cân bằng tay cầm'],
      specs: { 'Trọng lượng': '5U (78g)', 'Độ cứng': 'Trung bình', 'Chiều dài': '675mm' },
      badges: ['Tốc độ'],
    },
    {
      sku: 'VOT-LIN-001', name: 'Vợt Li-Ning Axforce 80', brand: 'Li-Ning', category: 'Vợt cầu lông',
      price: 2800000, originalPrice: 3200000, rating: 4.6, reviewsCount: 67, gender: null,
      description: 'Vợt toàn diện dòng Axforce, phù hợp mọi lối chơi từ tấn công đến phòng thủ.',
      features: ['Toàn diện', 'Độ bền cao', 'Dễ kiểm soát'],
      specs: { 'Trọng lượng': '4U (83g)', 'Độ cứng': 'Trung bình' },
      badges: ['Toàn diện'],
    },
    {
      sku: 'VOT-VIC-001', name: 'Vợt Victor Thruster K 9000', brand: 'Victor', category: 'Vợt cầu lông',
      price: 3200000, originalPrice: null, rating: 4.7, reviewsCount: 43, gender: null,
      description: 'Vợt tấn công cao cấp từ Victor, được các tuyển thủ chuyên nghiệp tin dùng.',
      features: ['Chuyên nghiệp', 'Tấn công mạnh', 'Carbon nano'],
      specs: { 'Trọng lượng': '4U (83g)', 'Độ cứng': 'Cứng' },
      badges: ['Chuyên nghiệp'],
    },
    // ── Cầu lông ──────────────────────────────
    {
      sku: 'CAU-YNX-001', name: 'Cầu lông Yonex Mavis 350', brand: 'Yonex', category: 'Cầu lông',
      price: 280000, originalPrice: null, rating: 4.5, reviewsCount: 203, gender: null,
      description: 'Cầu lông nhựa bền bỉ, bay ổn định, phù hợp sân trong nhà. Hộp 6 quả.',
      features: ['Lông nhựa bền', 'Bay ổn định', 'Phù hợp trong nhà', 'Hộp 6 quả'],
      specs: { 'Loại': 'Nhựa', 'Số lượng': '6 quả/hộp', 'Tốc độ': 'Trung bình' },
      badges: ['Bán chạy'],
    },
    {
      sku: 'CAU-YNX-002', name: 'Cầu lông lông vũ Yonex AS-50', brand: 'Yonex', category: 'Cầu lông',
      price: 680000, originalPrice: 750000, rating: 4.9, reviewsCount: 156, gender: null,
      description: 'Cầu lông lông vũ cao cấp dùng trong thi đấu chuyên nghiệp. Hộp 12 quả.',
      features: ['Lông vũ tự nhiên', 'Thi đấu chuyên nghiệp', 'Hộp 12 quả', 'Bay chuẩn xác'],
      specs: { 'Loại': 'Lông vũ', 'Số lượng': '12 quả/hộp', 'Tốc độ': 'Cao' },
      badges: ['Cao cấp', 'Thi đấu'],
    },
    // ── Giày cầu lông ─────────────────────────
    {
      sku: 'GIY-VIC-001', name: 'Giày Victor A362 III', brand: 'Victor', category: 'Giày cầu lông',
      price: 1650000, originalPrice: 2000000, rating: 4.6, reviewsCount: 78, gender: 'nam',
      description: 'Giày cầu lông chuyên dụng với đế cao su bám sân tốt, đệm khí giảm chấn.',
      features: ['Đế cao su bám sân', 'Đệm khí giảm chấn', 'Thoáng khí', 'Nhẹ'],
      specs: { 'Đế': 'Cao su', 'Trọng lượng': '320g', 'Phù hợp': 'Sân trong nhà' },
      badges: ['Giảm giá'],
    },
    {
      sku: 'GIY-YNX-001', name: 'Giày Yonex Power Cushion 65Z3', brand: 'Yonex', category: 'Giày cầu lông',
      price: 2800000, originalPrice: 3200000, rating: 4.8, reviewsCount: 52, gender: 'nam',
      description: 'Giày cao cấp nhất từ Yonex với công nghệ Power Cushion thế hệ 3.',
      features: ['Power Cushion 3', 'Đế gốm', 'Ổn định cao', 'Hỗ trợ mắt cá'],
      specs: { 'Đế': 'Gốm/Cao su', 'Công nghệ': 'Power Cushion 3', 'Phù hợp': 'Sân trong nhà' },
      badges: ['Cao cấp'],
    },
    // ── Túi & Balo ────────────────────────────
    {
      sku: 'BAG-YNX-001', name: 'Túi vợt Yonex BA82226', brand: 'Yonex', category: 'Túi & Balo',
      price: 950000, originalPrice: 1200000, rating: 4.7, reviewsCount: 61, gender: null,
      description: 'Túi đựng vợt cao cấp 6 ngăn với ngăn giày riêng biệt, chống thấm nước.',
      features: ['6 ngăn', 'Chống thấm', 'Ngăn giày riêng', 'Đựng được 6 vợt'],
      specs: { 'Số ngăn': '6', 'Sức chứa': '6 vợt', 'Chất liệu': 'Polyester chống thấm' },
      badges: ['Giảm giá'],
    },
    {
      sku: 'BAG-LIN-001', name: 'Balo Li-Ning ABSQ316', brand: 'Li-Ning', category: 'Túi & Balo',
      price: 750000, originalPrice: null, rating: 4.5, reviewsCount: 38, gender: null,
      description: 'Balo thể thao đa năng, đựng được 2 vợt và đầy đủ đồ dùng cá nhân.',
      features: ['Đựng 2 vợt', 'Ngăn laptop', 'Thoáng khí', 'Đai vai êm'],
      specs: { 'Sức chứa': '2 vợt + đồ dùng', 'Chất liệu': 'Polyester' },
      badges: [],
    },
    // ── Dây đan ───────────────────────────────
    {
      sku: 'DAY-YNX-001', name: 'Dây đan BG65 Yonex', brand: 'Yonex', category: 'Dây đan',
      price: 120000, originalPrice: null, rating: 4.9, reviewsCount: 312, gender: null,
      description: 'Dây đan phổ biến nhất thế giới, cân bằng hoàn hảo giữa sức bền và cảm giác đánh.',
      features: ['Độ bền cao', 'Cảm giác tốt', 'Phổ thông', 'Dễ đan'],
      specs: { 'Đường kính': '0.70mm', 'Vật liệu': 'Nylon', 'Độ căng max': '28 lbs' },
      badges: ['Bán chạy', 'Phổ biến nhất'],
    },
    {
      sku: 'DAY-YNX-002', name: 'Dây đan BG80 Yonex', brand: 'Yonex', category: 'Dây đan',
      price: 180000, originalPrice: null, rating: 4.8, reviewsCount: 187, gender: null,
      description: 'Dây đan cao cấp cho thi đấu, cảm giác sắc nét và tiếng vang rõ.',
      features: ['Cảm giác sắc nét', 'Tiếng vang', 'Thi đấu', 'Độ bền tốt'],
      specs: { 'Đường kính': '0.68mm', 'Vật liệu': 'Nylon cao cấp', 'Độ căng max': '30 lbs' },
      badges: ['Thi đấu'],
    },
    // ── Quần áo ───────────────────────────────
    {
      sku: 'QAO-YNX-001', name: 'Áo thi đấu Yonex 10559EX Nam', brand: 'Yonex', category: 'Quần áo',
      price: 580000, originalPrice: 720000, rating: 4.6, reviewsCount: 94, gender: 'nam',
      description: 'Áo thi đấu nam chính hãng Yonex, chất liệu Cool Dry thoáng khí, co giãn 4 chiều.',
      features: ['Cool Dry thoáng khí', 'Co giãn 4 chiều', 'Chống tia UV', 'Nhẹ'],
      specs: { 'Chất liệu': 'Polyester Cool Dry', 'Size': 'S-XL', 'Giới tính': 'Nam' },
      badges: ['Giảm giá'],
    },
    {
      sku: 'QAO-LIN-001', name: 'Váy thể thao Li-Ning ASKR394 Nữ', brand: 'Li-Ning', category: 'Quần áo',
      price: 620000, originalPrice: null, rating: 4.7, reviewsCount: 71, gender: 'nu',
      description: 'Váy thể thao nữ Li-Ning thiết kế năng động, tích hợp quần lót bên trong.',
      features: ['Tích hợp quần lót', 'Chất liệu mềm mại', 'Co giãn tốt', 'Năng động'],
      specs: { 'Chất liệu': 'Polyester + Spandex', 'Size': 'XS-L', 'Giới tính': 'Nữ' },
      badges: [],
    },
  ]

  for (const p of products) {
  const { badges, features, specs, gender, ...productData } = p  // ← tách gender ra riêng
  const product = await prisma.product.upsert({
    where: { sku: p.sku },
    update: {},
    create: {
      ...productData,
      features: features as any,
      specs: specs as any,
      inStock: true,
      gender: gender as Gender ?? null,  // ← cast riêng
    },
   })
  }

  console.log(`✅ Đã tạo ${products.length} sản phẩm`)

  // ═══════════════════════════════════════════════
  // INVENTORY — Tồn kho ban đầu cho 3 kho
  // ═══════════════════════════════════════════════
  const skuList = [
    { sku: 'VOT-YNX-001', name: 'Vợt Yonex Astrox 88D Pro',          category: 'Vợt cầu lông', unitCost: 3800000 },
    { sku: 'VOT-YNX-002', name: 'Vợt Yonex Nanoflare 700',            category: 'Vợt cầu lông', unitCost: 2900000 },
    { sku: 'VOT-LIN-001', name: 'Vợt Li-Ning Axforce 80',             category: 'Vợt cầu lông', unitCost: 2200000 },
    { sku: 'VOT-VIC-001', name: 'Vợt Victor Thruster K 9000',         category: 'Vợt cầu lông', unitCost: 3500000 },
    { sku: 'CAU-YNX-001', name: 'Cầu lông Yonex Mavis 350',           category: 'Cầu lông',     unitCost: 120000  },
    { sku: 'CAU-YNX-002', name: 'Cầu lông lông vũ Yonex AS-50',       category: 'Cầu lông',     unitCost: 350000  },
    { sku: 'GIY-VIC-001', name: 'Giày Victor A362 III',               category: 'Giày cầu lông',unitCost: 1100000 },
    { sku: 'GIY-YNX-001', name: 'Giày Yonex Power Cushion 65Z3',      category: 'Giày cầu lông',unitCost: 2800000 },
    { sku: 'BAG-YNX-001', name: 'Túi vợt Yonex BA82226',              category: 'Túi & Balo',   unitCost: 450000  },
    { sku: 'BAG-LIN-001', name: 'Balo Li-Ning ABSQ316',               category: 'Túi & Balo',   unitCost: 380000  },
    { sku: 'DAY-YNX-001', name: 'Dây đan BG65 Yonex',                 category: 'Dây đan',      unitCost: 55000   },
    { sku: 'DAY-YNX-002', name: 'Dây đan BG80 Yonex',                 category: 'Dây đan',      unitCost: 85000   },
    { sku: 'QAO-YNX-001', name: 'Áo thi đấu Yonex 10559EX Nam',      category: 'Quần áo',      unitCost: 320000  },
    { sku: 'QAO-LIN-001', name: 'Váy thể thao Li-Ning ASKR394 Nữ',   category: 'Quần áo',      unitCost: 280000  },
  ]

  // Mỗi kho có số lượng khác nhau
  const warehouseStock: Record<number, { onHand: number; reorderPoint: number }> = {
    1: { onHand: 50, reorderPoint: 10 }, // Kho Cầu Giấy
    2: { onHand: 30, reorderPoint: 8  }, // Kho Thanh Xuân
    3: { onHand: 20, reorderPoint: 5  }, // Kho Long Biên
  }

  for (const item of skuList) {
    // Lấy product_id từ DB
    const product = await prisma.$queryRaw<{ id: number }[]>`
      SELECT id FROM products WHERE sku = ${item.sku} LIMIT 1
    `
    const productId = product[0]?.id ?? null

    for (const [whIdStr, stock] of Object.entries(warehouseStock)) {
      const warehouseId = Number(whIdStr)
      const onHand = stock.onHand
      const reorderPoint = stock.reorderPoint

      await prisma.$executeRaw`
        INSERT INTO inventory (sku, product_id, warehouse_id, name, category, on_hand, reserved, available, reorder_point, unit_cost)
        VALUES (
          ${item.sku}, ${productId}, ${warehouseId},
          ${item.name}, ${item.category},
          ${onHand}, 0, ${onHand},
          ${reorderPoint}, ${item.unitCost}
        )
        ON CONFLICT (sku, warehouse_id) DO UPDATE SET
          on_hand       = EXCLUDED.on_hand,
          available     = EXCLUDED.available,
          reorder_point = EXCLUDED.reorder_point,
          unit_cost     = EXCLUDED.unit_cost
      `
    }
  }
  console.log(`✅ Tồn kho: ${skuList.length} sản phẩm × 3 kho = ${skuList.length * 3} bản ghi`)

  console.log('\n🎉 Seed hoàn tất!')
  console.log('─────────────────────────────────')
  console.log('📍 Chi nhánh: 3')
  console.log('🏸 Sân: 7')
  console.log(`📦 Sản phẩm: ${products.length}`)
  console.log('👤 Admin: admin / Admin@123')
  console.log('👤 Employee: employee1 / Employee@123')
  console.log('─────────────────────────────────')

  // SUPPLIERS
  await prisma.$executeRaw`
    INSERT INTO suppliers (name, contact_person, phone, email, is_active)
    VALUES
      ('Yonex Việt Nam', 'Nguyễn Văn A', '0901234567', 'yonex@vn.com', true),
      ('Li-Ning Việt Nam', 'Trần Thị B', '0912345678', 'lining@vn.com', true),
      ('Victor Việt Nam', 'Lê Văn C', '0923456789', 'victor@vn.com', true)
    ON CONFLICT DO NOTHING
  `
  console.log('✅ 3 nhà cung cấp')
}

main()
  .catch((e) => {
    console.error('❌ Seed thất bại:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })