// prisma/seed.ts
// Chạy: npx prisma db seed

import {
  CommunityDistrict,
  CommunityLevel,
  CommunityNotificationKind,
  CommunityPostKind,
  PrismaClient,
} from '@prisma/client'
import * as bcrypt from 'bcrypt'
type Gender = 'nam' | 'nu'

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

  await prisma.warehouse.upsert({
    where: { id: 4 },
    update: {
      isHub: true,
    },
    create: {
      id: 4,
      name: 'Kho Hub',
      branchId: null,
      isHub: true,
      isActive: true,
    },
  })
  console.log('✅ 4 kho hàng')

  // ═══════════════════════════════════════════════
  // 3. ADMIN USER — Tài khoản quản trị
  // ═══════════════════════════════════════════════
  console.log('👤 Tạo tài khoản admin...')

  const passwordHash = await bcrypt.hash('Admin@123', 10)

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash },   // ← luôn reset password khi seed
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
      warehouseId: 1,
    },
  })

  await prisma.user.upsert({
    where: { username: 'hub' },
    update: { warehouseId: 4 },
    create: {
      username: 'hub',
      passwordHash: await bcrypt.hash('Employee@123', 10),
      fullName: 'Thủ kho HUB',
      email: 'hub@badmintonhub.vn',
      phone: '0905555555',
      role: 'employee',
      warehouseId: 4,
    },
  })

  console.log('✅ Đã tạo tài khoản admin, employee và thủ kho hub')

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
    4: { onHand: 150, reorderPoint: 15 }, // Kho Hub
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
  console.log(`✅ Tồn kho: ${skuList.length} sản phẩm × ${Object.keys(warehouseStock).length} kho = ${skuList.length * Object.keys(warehouseStock).length} bản ghi`)

  // ═══════════════════════════════════════════════════════
  // 7. COMMUNITY — dữ liệu mạng xã hội mini
  // ═══════════════════════════════════════════════════════
  console.log('🏸 Tạo dữ liệu community...')

  await prisma.communityNotification.deleteMany()
  await prisma.communityMatchParticipant.deleteMany()
  await prisma.communityMatch.deleteMany()
  await prisma.communityCommentLike.deleteMany()
  await prisma.communityComment.deleteMany()
  await prisma.communityPostLike.deleteMany()
  await prisma.communityPostSave.deleteMany()
  await prisma.communityPostHashtag.deleteMany()
  await prisma.communityPostMedia.deleteMany()
  await prisma.communityPost.deleteMany()
  await prisma.communityHashtag.deleteMany()
  await prisma.communityFollow.deleteMany()
  await prisma.communityProfile.deleteMany()

  const communityPassword = await bcrypt.hash('Community@123', 10)

  const communityUsers = {
    minhsmash: await prisma.user.upsert({
      where: { username: 'minhsmash' },
      update: { passwordHash: communityPassword },
      create: {
        username: 'minhsmash',
        passwordHash: communityPassword,
        fullName: 'Trần Nhật Minh',
        email: 'minhsmash@badmintonhub.vn',
        phone: '0903000001',
        role: 'user',
      },
    }),
    linhdrop: await prisma.user.upsert({
      where: { username: 'linhdrop' },
      update: { passwordHash: communityPassword },
      create: {
        username: 'linhdrop',
        passwordHash: communityPassword,
        fullName: 'Phạm Khánh Linh',
        email: 'linhdrop@badmintonhub.vn',
        phone: '0903000002',
        role: 'user',
      },
    }),
    quannet: await prisma.user.upsert({
      where: { username: 'quannet' },
      update: { passwordHash: communityPassword },
      create: {
        username: 'quannet',
        passwordHash: communityPassword,
        fullName: 'Lê Anh Quân',
        email: 'quannet@badmintonhub.vn',
        phone: '0903000003',
        role: 'user',
      },
    }),
    huedefense: await prisma.user.upsert({
      where: { username: 'huedefense' },
      update: { passwordHash: communityPassword },
      create: {
        username: 'huedefense',
        passwordHash: communityPassword,
        fullName: 'Đỗ Thu Huế',
        email: 'huedefense@badmintonhub.vn',
        phone: '0903000004',
        role: 'user',
      },
    }),
    tungrally: await prisma.user.upsert({
      where: { username: 'tungrally' },
      update: { passwordHash: communityPassword },
      create: {
        username: 'tungrally',
        passwordHash: communityPassword,
        fullName: 'Vũ Thanh Tùng',
        email: 'tungrally@badmintonhub.vn',
        phone: '0903000005',
        role: 'user',
      },
    }),
  }

  const allCourts = await prisma.court.findMany({
    include: { branch: true },
    orderBy: { id: 'asc' },
  })

  const courtCauGiay = allCourts.find((court) => court.branchId === 1) ?? allCourts[0]
  const courtThanhXuan = allCourts.find((court) => court.branchId === 2) ?? allCourts[1]
  const courtLongBien = allCourts.find((court) => court.branchId === 3) ?? allCourts[2]

  await prisma.communityProfile.createMany({
    data: [
      {
        userId: communityUsers.minhsmash.id,
        avatar: null,
        coverImage: '/community/hero.png',
        bio: 'Đập cầu là đam mê. Chơi tối T2-T4-T6 ở Cầu Giấy. Tìm bạn đánh đôi ổn định.',
        district: CommunityDistrict.cau_giay,
        level: CommunityLevel.expert,
        followersCount: 3,
        followingCount: 2,
        matchesCount: 2,
        checkinsCount: 1,
      },
      {
        userId: communityUsers.linhdrop.id,
        avatar: null,
        coverImage: '/community/hero.png',
        bio: 'Cầu lông + cà phê = cuối tuần hoàn hảo. Hay tổ chức kèo đôi nữ.',
        district: CommunityDistrict.thanh_xuan,
        level: CommunityLevel.advanced,
        followersCount: 3,
        followingCount: 2,
        matchesCount: 1,
        checkinsCount: 1,
      },
      {
        userId: communityUsers.quannet.id,
        avatar: null,
        coverImage: '/community/hero.png',
        bio: 'Mới quay lại sau 2 năm nghỉ. Đang tìm nhóm trình trung bình đánh vui.',
        district: CommunityDistrict.long_bien,
        level: CommunityLevel.intermediate,
        followersCount: 0,
        followingCount: 2,
        matchesCount: 1,
        checkinsCount: 0,
      },
      {
        userId: communityUsers.huedefense.id,
        avatar: null,
        coverImage: '/community/hero.png',
        bio: 'Phòng thủ là nghệ thuật. HLV bán thời gian, nhận kèo giao lưu.',
        district: CommunityDistrict.cau_giay,
        level: CommunityLevel.expert,
        followersCount: 3,
        followingCount: 1,
        matchesCount: 1,
        checkinsCount: 0,
      },
      {
        userId: communityUsers.tungrally.id,
        avatar: null,
        coverImage: '/community/hero.png',
        bio: 'Mê những pha cầu dài. Săn vợt cũ, chia sẻ review giày.',
        district: CommunityDistrict.thanh_xuan,
        level: CommunityLevel.advanced,
        followersCount: 0,
        followingCount: 3,
        matchesCount: 0,
        checkinsCount: 0,
      },
    ],
  })

  await prisma.communityFollow.createMany({
    data: [
      { followerId: communityUsers.minhsmash.id, followingId: communityUsers.linhdrop.id },
      { followerId: communityUsers.minhsmash.id, followingId: communityUsers.huedefense.id },
      { followerId: communityUsers.linhdrop.id, followingId: communityUsers.minhsmash.id },
      { followerId: communityUsers.linhdrop.id, followingId: communityUsers.huedefense.id },
      { followerId: communityUsers.quannet.id, followingId: communityUsers.minhsmash.id },
      { followerId: communityUsers.quannet.id, followingId: communityUsers.linhdrop.id },
      { followerId: communityUsers.huedefense.id, followingId: communityUsers.minhsmash.id },
      { followerId: communityUsers.tungrally.id, followingId: communityUsers.minhsmash.id },
      { followerId: communityUsers.tungrally.id, followingId: communityUsers.linhdrop.id },
      { followerId: communityUsers.tungrally.id, followingId: communityUsers.huedefense.id },
    ],
    skipDuplicates: true,
  })

  const postMinh = await prisma.communityPost.create({
    data: {
      authorId: communityUsers.minhsmash.id,
      kind: CommunityPostKind.find_team,
      body: 'Tối nay 20h cần thêm 2 bạn đánh đôi nam trình Khá trở lên tại Cầu Giấy. Sân đã đặt, chia tiền sân nhẹ nhàng. Ai máu thì vào kèo nhé!',
      district: CommunityDistrict.cau_giay,
      level: CommunityLevel.advanced,
      branchId: branch1.id,
      courtId: courtCauGiay?.id ?? null,
      media: {
        create: [
          {
            url: '/community/hero.png',
            sortOrder: 0,
          },
        ],
      },
    },
  })

  const postLinh = await prisma.communityPost.create({
    data: {
      authorId: communityUsers.linhdrop.id,
      kind: CommunityPostKind.check_in,
      body: 'Vừa xong 2 tiếng cháy hết mình ở Thanh Xuân. Cảm giác smash trúng tim cầu đã không tả nổi. Cảm ơn team nữ chiến đã quẩy cùng!',
      district: CommunityDistrict.thanh_xuan,
      branchId: branch2.id,
      courtId: courtThanhXuan?.id ?? null,
      media: {
        create: [
          { url: '/community/hero.png', sortOrder: 0 },
          { url: '/community/hero.png', sortOrder: 1 },
        ],
      },
    },
  })

  const postTung = await prisma.communityPost.create({
    data: {
      authorId: communityUsers.tungrally.id,
      kind: CommunityPostKind.court_review,
      body: 'Review nhanh sân Long Biên: mặt sàn bám tốt, ánh sáng đều không chói, ít gió. Điểm trừ duy nhất là chỗ để xe hơi chật giờ cao điểm. Tổng 9/10.',
      district: CommunityDistrict.long_bien,
      branchId: branch3.id,
      courtId: courtLongBien?.id ?? null,
      media: {
        create: [
          { url: '/community/hero.png', sortOrder: 0 },
        ],
      },
    },
  })

  const postHue = await prisma.communityPost.create({
    data: {
      authorId: communityUsers.huedefense.id,
      kind: CommunityPostKind.tip,
      body: 'Mẹo phòng thủ cho người mới: đừng nhìn vợt đối thủ, hãy nhìn vai và cổ tay họ để đoán hướng cầu sớm hơn nửa nhịp. Cực kỳ hiệu quả trong đánh đôi.',
      district: CommunityDistrict.cau_giay,
      level: CommunityLevel.intermediate,
      branchId: branch1.id,
    },
  })

  const hashtags = ['timdoi', 'checkin', 'reviewsan', 'meochoi', 'caugiay', 'thanhxuan', 'longbien']
  const hashtagMap = new Map<string, number>()
  for (const slug of hashtags) {
    const hashtag = await prisma.communityHashtag.create({
      data: { slug, label: slug },
    })
    hashtagMap.set(slug, hashtag.id)
  }

  await prisma.communityPostHashtag.createMany({
    data: [
      { postId: postMinh.id, hashtagId: hashtagMap.get('timdoi')! },
      { postId: postMinh.id, hashtagId: hashtagMap.get('caugiay')! },
      { postId: postLinh.id, hashtagId: hashtagMap.get('checkin')! },
      { postId: postLinh.id, hashtagId: hashtagMap.get('thanhxuan')! },
      { postId: postTung.id, hashtagId: hashtagMap.get('reviewsan')! },
      { postId: postTung.id, hashtagId: hashtagMap.get('longbien')! },
      { postId: postHue.id, hashtagId: hashtagMap.get('meochoi')! },
      { postId: postHue.id, hashtagId: hashtagMap.get('caugiay')! },
    ],
    skipDuplicates: true,
  })

  const comment1 = await prisma.communityComment.create({
    data: {
      postId: postMinh.id,
      authorId: communityUsers.tungrally.id,
      body: 'Cho mình 1 slot với, trình Khá ổn áp luôn.',
    },
  })
  const comment2 = await prisma.communityComment.create({
    data: {
      postId: postMinh.id,
      authorId: communityUsers.quannet.id,
      body: 'Lần sau rủ mình nha, tối nay bận mất rồi.',
    },
  })
  const comment3 = await prisma.communityComment.create({
    data: {
      postId: postLinh.id,
      authorId: communityUsers.huedefense.id,
      body: 'Nhìn là biết đã lắm! Hôm nào giao lưu nhé.',
    },
  })

  await prisma.communityPostLike.createMany({
    data: [
      { postId: postMinh.id, userId: communityUsers.tungrally.id },
      { postId: postMinh.id, userId: communityUsers.quannet.id },
      { postId: postLinh.id, userId: communityUsers.minhsmash.id },
      { postId: postLinh.id, userId: communityUsers.huedefense.id },
      { postId: postTung.id, userId: communityUsers.minhsmash.id },
      { postId: postTung.id, userId: communityUsers.linhdrop.id },
      { postId: postHue.id, userId: communityUsers.minhsmash.id },
      { postId: postHue.id, userId: communityUsers.linhdrop.id },
      { postId: postHue.id, userId: communityUsers.quannet.id },
    ],
    skipDuplicates: true,
  })

  await prisma.communityPostSave.createMany({
    data: [
      { postId: postHue.id, userId: communityUsers.minhsmash.id },
      { postId: postHue.id, userId: communityUsers.linhdrop.id },
      { postId: postTung.id, userId: communityUsers.minhsmash.id },
      { postId: postMinh.id, userId: communityUsers.quannet.id },
    ],
    skipDuplicates: true,
  })

  await prisma.communityCommentLike.createMany({
    data: [
      { commentId: comment1.id, userId: communityUsers.minhsmash.id },
      { commentId: comment1.id, userId: communityUsers.linhdrop.id },
      { commentId: comment2.id, userId: communityUsers.minhsmash.id },
      { commentId: comment3.id, userId: communityUsers.linhdrop.id },
    ],
    skipDuplicates: true,
  })

  const match1 = await prisma.communityMatch.create({
    data: {
      hostId: communityUsers.minhsmash.id,
      title: 'Đánh đôi nam tối thứ 6',
      district: CommunityDistrict.cau_giay,
      level: CommunityLevel.advanced,
      branchId: branch1.id,
      courtId: courtCauGiay?.id ?? null,
      date: new Date('2026-06-13'),
      slotStart: '20:00',
      slotEnd: '22:00',
      currentPlayers: 2,
      neededPlayers: 4,
      pricePerPerson: 60000,
      note: 'Cần thêm 2 bạn đánh đôi nam, trình Khá trở lên, đánh nhiệt tình vui vẻ.',
    },
  })

  const match2 = await prisma.communityMatch.create({
    data: {
      hostId: communityUsers.linhdrop.id,
      title: 'Kèo đôi nữ cuối tuần',
      district: CommunityDistrict.thanh_xuan,
      level: CommunityLevel.intermediate,
      branchId: branch2.id,
      courtId: courtThanhXuan?.id ?? null,
      date: new Date('2026-06-14'),
      slotStart: '08:00',
      slotEnd: '10:00',
      currentPlayers: 3,
      neededPlayers: 4,
      pricePerPerson: 50000,
      note: 'Nhóm nữ vui tính, chỉ thiếu 1 bạn. Ưu tiên gần Thanh Xuân.',
    },
  })

  const match3 = await prisma.communityMatch.create({
    data: {
      hostId: communityUsers.quannet.id,
      title: 'Giao lưu trình trung bình',
      district: CommunityDistrict.long_bien,
      level: CommunityLevel.intermediate,
      branchId: branch3.id,
      courtId: courtLongBien?.id ?? null,
      date: new Date('2026-06-15'),
      slotStart: '17:00',
      slotEnd: '19:00',
      currentPlayers: 4,
      neededPlayers: 8,
      pricePerPerson: 45000,
      note: 'Đánh vui là chính, không quan trọng thắng thua. Còn 4 slot.',
    },
  })

  const match4 = await prisma.communityMatch.create({
    data: {
      hostId: communityUsers.huedefense.id,
      title: 'Buổi tập kỹ thuật phòng thủ',
      district: CommunityDistrict.cau_giay,
      level: CommunityLevel.expert,
      branchId: branch1.id,
      courtId: courtCauGiay?.id ?? null,
      date: new Date('2026-06-12'),
      slotStart: '19:00',
      slotEnd: '21:00',
      currentPlayers: 5,
      neededPlayers: 6,
      pricePerPerson: 70000,
      note: 'Có HLV hướng dẫn. Phù hợp bạn muốn nâng trình phòng thủ.',
    },
  })

  await prisma.communityMatchParticipant.createMany({
    data: [
      { matchId: match1.id, userId: communityUsers.tungrally.id, status: 'joined' },
      { matchId: match2.id, userId: communityUsers.huedefense.id, status: 'joined' },
      { matchId: match2.id, userId: communityUsers.minhsmash.id, status: 'joined' },
      { matchId: match3.id, userId: communityUsers.minhsmash.id, status: 'joined' },
      { matchId: match3.id, userId: communityUsers.linhdrop.id, status: 'joined' },
      { matchId: match3.id, userId: communityUsers.tungrally.id, status: 'joined' },
      { matchId: match4.id, userId: communityUsers.minhsmash.id, status: 'joined' },
      { matchId: match4.id, userId: communityUsers.linhdrop.id, status: 'joined' },
      { matchId: match4.id, userId: communityUsers.tungrally.id, status: 'joined' },
      { matchId: match4.id, userId: communityUsers.quannet.id, status: 'joined' },
    ],
    skipDuplicates: true,
  })

  await prisma.communityNotification.createMany({
    data: [
      {
        userId: communityUsers.minhsmash.id,
        actorId: communityUsers.tungrally.id,
        kind: CommunityNotificationKind.match,
        text: 'đã xin tham gia kèo "Đánh đôi nam tối thứ 6" của bạn.',
        targetType: 'match',
        targetId: match1.id,
      },
      {
        userId: communityUsers.linhdrop.id,
        actorId: communityUsers.huedefense.id,
        kind: CommunityNotificationKind.like,
        text: 'đã thích bài check-in của bạn ở Thanh Xuân.',
        targetType: 'post',
        targetId: postLinh.id,
      },
      {
        userId: communityUsers.minhsmash.id,
        actorId: communityUsers.quannet.id,
        kind: CommunityNotificationKind.comment,
        text: 'đã bình luận: "Lần sau rủ mình nha".',
        targetType: 'post',
        targetId: postMinh.id,
      },
      {
        userId: communityUsers.minhsmash.id,
        actorId: communityUsers.linhdrop.id,
        kind: CommunityNotificationKind.follow,
        text: 'đã bắt đầu theo dõi bạn.',
        targetType: 'profile',
        targetId: communityUsers.minhsmash.username,
      },
    ],
  })

  console.log('✅ Community: 5 người chơi, 4 bài viết, 4 kèo, notifications mẫu')

  console.log('\n🎉 Seed hoàn tất!')
  console.log('─────────────────────────────────')
  console.log('📍 Chi nhánh: 3')
  console.log('🏸 Sân: 7')
  console.log(`📦 Sản phẩm: ${products.length}`)
  console.log('👤 Admin: admin / Admin@123')
  console.log('👤 Employee: employee1 / Employee@123')
  console.log('👤 Thủ kho HUB: hub / Employee@123')
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
