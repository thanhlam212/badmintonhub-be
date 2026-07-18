import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AiChatDto } from './dto/ai-chat.dto';

type GeminiPart = { text?: string };
type GeminiContent = { role?: 'user' | 'model'; parts: GeminiPart[] };
type OpenAiInputMessage = {
  role: 'user' | 'assistant' | 'developer';
  content: string;
};
type OpenAiOutputContent = { type?: string; text?: string };
type OpenAiOutputItem = { type?: string; content?: OpenAiOutputContent[] };

const PROJECT_KNOWLEDGE = `
Bạn là trợ lý AI của dự án BadmintonHub. Trả lời bằng tiếng Việt, ngắn gọn, thân thiện, chính xác theo hệ thống.

Tổng quan dự án:
- BadmintonHub là hệ thống đặt sân cầu lông online, quản lý lịch sân, lịch cố định, thanh toán, QR check-in, cửa hàng phụ kiện, đơn hàng, kho, chuyển kho, mua hàng, bán hàng và cộng đồng người chơi.
- Frontend dùng Next.js/React, backend dùng NestJS, Prisma, PostgreSQL. API được bọc dạng { success, data }.
- Người dùng chính: khách/user, nhân viên/employee, admin.

Luồng đặt sân thường:
- Người dùng chọn chi nhánh, sân, ngày, khung giờ, nhập thông tin liên hệ và chọn thanh toán.
- Booking có các trạng thái: hold, pending, deposited, confirmed, playing, completed, cancelled.
- Booking online có thể giữ chỗ tạm, thanh toán qua VNPay/MoMo/SePay hoặc tiền mặt/chuyển khoản tùy luồng.
- Nhân viên/admin có thể xác nhận thanh toán, check-in, hoàn thành, hủy/từ chối booking.
- Check-in thường chỉ được thực hiện sát giờ chơi. Nếu đã qua giờ và admin/nhân viên xử lý quên check-in thì hệ thống có thể hoàn thành bù.

Luồng lịch cố định:
- Người dùng chọn nhiều khung giờ 1 tiếng liền mạch, không được ngắt quãng.
- Lịch cố định có chu kỳ daily/weekly/monthly, sinh ra nhiều buổi occurrence.
- Người dùng có quota điều chỉnh lịch cố định. Nhân viên có thể setting số lượt đổi.
- User gửi yêu cầu đổi ngày/giờ, đổi sân hoặc báo nghỉ. Nhân viên duyệt/từ chối. Nếu từ chối phải có lý do để user thấy.
- Yêu cầu đổi/hủy lịch cố định phải gửi trước buổi chơi ít nhất 3 ngày.
- Form đổi lịch có lịch trực quan để chọn ngày và đối chiếu ngày đang có lịch.

Trang người dùng:
- /courts: xem sân, lọc/tìm sân.
- /booking: đặt sân thường.
- /booking/fixed-schedule: đặt lịch cố định.
- /my-bookings: xem lịch đặt, đơn hàng, lịch cố định, yêu cầu điều chỉnh.
- /shop: mua phụ kiện.
- /community: cộng đồng, tìm người chơi, bài viết, trận cộng đồng.

Trang nhân viên/admin:
- /employee/bookings: quản lý booking theo ngày, tuần, tháng, tất cả; check-in, hoàn thành, đặt nhanh trên lưới sân.
- /employee/bookings/fixed-schedules: quản lý lịch cố định, quota đổi lịch, duyệt/từ chối yêu cầu điều chỉnh.
- Admin có thêm quyền quản lý sân, chi nhánh, user, kho, sản phẩm, đơn hàng, báo cáo.

Quy tắc trả lời:
- Nếu người dùng hỏi cách đặt sân, hướng dẫn từng bước cụ thể.
- Nếu hỏi lỗi thao tác, nêu nguyên nhân thường gặp và bước kiểm tra.
- Nếu hỏi giá/sân/chi nhánh hiện có, dựa vào dữ liệu live được cung cấp trong prompt.
- Không bịa dữ liệu thanh toán, mã booking, lịch trống thực tế nếu không có trong context.
- Không yêu cầu người dùng cung cấp mật khẩu, OTP, token hoặc thông tin nhạy cảm.
- Khi cần thao tác trong hệ thống, chỉ hướng dẫn nơi bấm; không nói bạn đã tự thực hiện thao tác nếu không có công cụ thực hiện.
`;

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async chat(dto: AiChatDto) {
    const message = dto.message.trim();
    const context = await this.buildLiveContext();
    const fallback = this.buildFallbackAnswer(message, context);

    const openAiKey = this.getOpenAiApiKey();
    if (openAiKey) {
      try {
        const reply = await this.askOpenAi({
          apiKey: openAiKey,
          message,
          history: dto.history || [],
          liveContext: context,
        });

        return {
          reply: reply || fallback,
          provider: 'openai',
          quickReplies: this.quickReplies(),
        };
      } catch (error) {
        this.logger.warn(
          `OpenAI chat failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    const geminiKey = this.getGeminiApiKey();
    if (geminiKey) {
      try {
        const reply = await this.askGemini({
          apiKey: geminiKey,
          message,
          history: dto.history || [],
          liveContext: context,
        });

        return {
          reply: reply || fallback,
          provider: 'gemini',
          quickReplies: this.quickReplies(),
        };
      } catch (error) {
        this.logger.warn(
          `Gemini chat failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    }

    return {
      reply: fallback,
      provider: 'local',
      quickReplies: this.quickReplies(),
    };
  }

  private async buildLiveContext() {
    const [branches, courts, productStats] = await Promise.all([
      this.prisma.branch.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          courts: {
            where: { available: true },
            select: {
              id: true,
              name: true,
              type: true,
              price: true,
              hours: true,
              indoor: true,
              available: true,
            },
            orderBy: { name: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.court.count({ where: { available: true } }),
      this.prisma.product.groupBy({
        by: ['category'],
        where: { inStock: true },
        _count: { id: true },
      }),
    ]);

    const branchLines = branches.map((branch) => {
      const courtLines = branch.courts
        .slice(0, 8)
        .map(
          (court) =>
            `${court.name} (${court.type}, ${Number(court.price).toLocaleString('vi-VN')}đ/giờ, ${court.hours || '06:00 - 22:00'})`,
        )
        .join('; ');
      return `- ${branch.name}: ${branch.address}${branch.phone ? `, SĐT ${branch.phone}` : ''}. Sân: ${courtLines || 'chưa có sân khả dụng'}`;
    });

    const productLines = productStats
      .map((item) => `- ${item.category}: ${item._count.id} sản phẩm còn hàng`)
      .join('\n');

    return `
Dữ liệu live hiện tại:
- Số sân đang khả dụng: ${courts}
- Chi nhánh và sân:
${branchLines.join('\n') || '- Chưa có dữ liệu chi nhánh'}
- Nhóm sản phẩm còn hàng:
${productLines || '- Chưa có dữ liệu sản phẩm'}
`;
  }

  private async askGemini({
    apiKey,
    message,
    history,
    liveContext,
  }: {
    apiKey: string;
    message: string;
    history: NonNullable<AiChatDto['history']>;
    liveContext: string;
  }) {
    const configuredModel =
      this.config.get<string>('GEMINI_MODEL') || 'gemini-2.0-flash';
    const model = configuredModel.replace(/^models\//, '');
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const contents: GeminiContent[] = history.slice(-8).map((item) => ({
      role: item.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: item.content }],
    }));
    contents.push({ role: 'user', parts: [{ text: message }] });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: {
          parts: [{ text: `${PROJECT_KNOWLEDGE}\n${liveContext}` }],
        },
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 700,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gemini ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    return parts.map((part: GeminiPart) => part.text || '').join('').trim();
  }

  private async askOpenAi({
    apiKey,
    message,
    history,
    liveContext,
  }: {
    apiKey: string;
    message: string;
    history: NonNullable<AiChatDto['history']>;
    liveContext: string;
  }) {
    const model = this.config.get<string>('OPENAI_MODEL') || 'gpt-5.2';
    const input: OpenAiInputMessage[] = [
      {
        role: 'developer',
        content: `${PROJECT_KNOWLEDGE}\n${liveContext}`,
      },
      ...history.slice(-8).map((item) => ({
        role: item.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: item.content,
      })),
      { role: 'user', content: message },
    ];

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input,
        temperature: 0.35,
        max_output_tokens: 700,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await response.json();
    if (typeof data?.output_text === 'string' && data.output_text.trim()) {
      return data.output_text.trim();
    }

    const output = Array.isArray(data?.output) ? data.output : [];
    return output
      .flatMap((item: OpenAiOutputItem) => item.content || [])
      .filter((content: OpenAiOutputContent) => content.type === 'output_text')
      .map((content: OpenAiOutputContent) => content.text || '')
      .join('')
      .trim();
  }

  private buildFallbackAnswer(message: string, liveContext: string) {
    const lower = this.normalizeText(message);

    if (
      this.includesAny(lower, [
        'lich co dinh',
        'co dinh',
        'fixed schedule',
        'quota',
        'so luot doi',
      ])
    ) {
      return [
        'Lịch cố định trong BadmintonHub dùng cho người chơi muốn giữ sân theo chu kỳ, ví dụ tuần nào cũng chơi cùng một khung giờ.',
        '',
        'Cách đặt lịch cố định:',
        '1. Vào /booking/fixed-schedule.',
        '2. Chọn chi nhánh, sân, ngày bắt đầu và chu kỳ daily/weekly/monthly.',
        '3. Chọn nhiều khung giờ 1 tiếng nếu muốn chơi hơn 1 giờ. Các khung giờ phải liền mạch, ví dụ 18:00-19:00 + 19:00-20:00. Nếu chọn ngắt quãng như 18:00 và 20:00, form sẽ hiện lưu ý và không cho xác nhận.',
        '4. Xem danh sách buổi được sinh ra ở phần preview, gồm ngày chơi, sân, giờ, giá và trạng thái khả dụng.',
        '5. Xác nhận lịch và thanh toán theo luồng hệ thống.',
        '',
        'Quy tắc đổi lịch cố định:',
        '- User có số lượt đổi lịch, do nhân viên setting ở trang /employee/bookings/fixed-schedules.',
        '- Muốn đổi ngày/giờ/sân hoặc báo nghỉ thì vào /my-bookings, chọn lịch cố định và buổi cần chỉnh.',
        '- Form đổi lịch có lịch trực quan để chọn ngày mới và đối chiếu với ngày đang có lịch.',
        '- Yêu cầu đổi/hủy phải gửi trước buổi chơi ít nhất 3 ngày. Nếu quá hạn, form booking/my-bookings sẽ bị lock để tránh user tưởng vẫn sửa được.',
        '- Nhân viên duyệt thì occurrence được cập nhật theo yêu cầu. Nhân viên từ chối thì bắt buộc nhập lý do, và user nhìn thấy lý do từ chối trong phần yêu cầu điều chỉnh.',
      ].join('\n');
    }

    if (
      this.includesAny(lower, [
        'doi lich',
        'dieu chinh',
        'tu choi',
        'ly do',
        'bao nghi',
        'adjust',
      ])
    ) {
      return [
        'Luồng đổi lịch của user trong BadmintonHub hoạt động như sau:',
        '',
        '1. User vào /my-bookings, mở tab lịch cố định hoặc chi tiết gói lịch.',
        '2. User chọn một buổi occurrence còn đủ điều kiện. Nếu buổi chơi cách hiện tại dưới 3 ngày thì nút/form điều chỉnh bị lock.',
        '3. User chọn loại yêu cầu: đổi ngày/giờ, đổi sân hoặc báo nghỉ.',
        '4. Với đổi ngày/giờ, form cho chọn trực tiếp trên lịch để dễ đối chiếu ngày hiện tại và ngày muốn chuyển.',
        '5. Hệ thống kiểm tra slot mới có trống không, có trùng lịch không và số lượt đổi còn lại của user.',
        '6. Yêu cầu chuyển sang trạng thái chờ nhân viên duyệt.',
        '7. Nhân viên vào /employee/bookings/fixed-schedules để duyệt hoặc từ chối.',
        '8. Nếu duyệt, lịch được cập nhật và quota đổi lịch bị trừ theo rule. Nếu từ chối, nhân viên phải nhập lý do; user sẽ thấy thông báo từ chối kèm lý do trong /my-bookings.',
      ].join('\n');
    }

    if (
      this.includesAny(lower, [
        'dat san',
        'booking',
        'san thuong',
        'khung gio',
        'check in',
        'checkin',
      ])
    ) {
      return [
        'Luồng đặt sân thường trong BadmintonHub:',
        '',
        '1. User vào /courts để xem sân hoặc vào /booking để đặt nhanh.',
        '2. Chọn chi nhánh, sân, ngày chơi và khung giờ còn trống.',
        '3. Nhập thông tin liên hệ hoặc dùng thông tin tài khoản đang đăng nhập.',
        '4. Chọn phương thức thanh toán. Booking có thể đi qua các trạng thái hold, pending, deposited, confirmed, playing, completed hoặc cancelled.',
        '5. Khi thanh toán/xác nhận xong, user dùng QR hoặc mã booking để check-in tại sân.',
        '6. Nhân viên/admin quản lý booking ở /employee/bookings: lọc theo hôm nay, tất cả, tuần này, tháng hoặc chọn tháng/ngày tương lai.',
        '7. Nếu quên check-in cho lịch đã qua, admin check-in hộ thì hệ thống đưa booking vào hoàn thành luôn thay vì đang chơi.',
        '',
        'Nếu user muốn đặt lặp lại nhiều buổi cố định, nên dùng /booking/fixed-schedule thay vì đặt từng ngày.',
      ].join('\n');
    }

    if (
      this.includesAny(lower, [
        'nhan vien',
        'employee',
        'admin',
        'quan ly booking',
        'loc ngay',
        'hom nay',
      ])
    ) {
      return [
        'Trang nhân viên/admin liên quan booking:',
        '',
        '- /employee/bookings: mặc định hiển thị booking ngày hiện tại của nhân viên. Danh sách ưu tiên ngày mới nhất, có bộ lọc tất cả, tuần này, tháng và chọn tháng/ngày cụ thể để xem đơn tương lai.',
        '- Nhân viên có thể check-in, hoàn thành, xác nhận thanh toán, hủy/từ chối booking và đặt nhanh trên lưới sân.',
        '- Nếu xử lý quên check-in cho booking đã qua giờ, check-in bù sẽ chuyển booking sang completed để phản ánh đúng thực tế.',
        '- /employee/bookings/fixed-schedules: quản lý lịch cố định, xem occurrence, đặt số lượt đổi lịch cho user, duyệt/từ chối yêu cầu điều chỉnh.',
        '- Khi từ chối yêu cầu đổi lịch cố định, nhân viên phải nhập lý do để user nhìn thấy thông báo từ chối.',
      ].join('\n');
    }

    if (this.includesAny(lower, ['thanh toan', 'payment', 'vnpay', 'momo', 'sepay'])) {
      return [
        'Thanh toán trong BadmintonHub được dùng cho booking sân và đơn hàng phụ kiện.',
        '',
        '- Booking có thể thanh toán online qua cổng được cấu hình như VNPay, MoMo, SePay hoặc xử lý tiền mặt/chuyển khoản tại quầy tùy luồng.',
        '- Sau khi thanh toán được xác nhận, booking chuyển sang trạng thái phù hợp như deposited/confirmed để có thể check-in.',
        '- Nhân viên/admin có thể xác nhận thanh toán thủ công nếu khách thanh toán tại quầy hoặc chuyển khoản cần đối soát.',
        '- Với lịch cố định, thanh toán/xác nhận giúp gói lịch được giữ ổn định và sinh các buổi occurrence theo chu kỳ đã chọn.',
      ].join('\n');
    }

    if (this.includesAny(lower, ['san', 'chi nhanh', 'gia', 'court', 'branch'])) {
      return [
        'Mình có dữ liệu tổng quan về chi nhánh và sân hiện có:',
        liveContext,
        'Bạn có thể hỏi cụ thể hơn như "sân VIP giá bao nhiêu", "chi nhánh nào còn sân", hoặc "sân nào phù hợp chơi buổi tối".',
      ].join('\n');
    }

    if (this.includesAny(lower, ['shop', 'phu kien', 'san pham', 'don hang', 'kho'])) {
      return [
        'BadmintonHub ngoài đặt sân còn có shop và quản lý kho:',
        '',
        '- User vào /shop để mua phụ kiện cầu lông, thêm vào giỏ hàng và checkout.',
        '- User xem đơn hàng trong /my-bookings cùng khu vực lịch đặt.',
        '- Nhân viên/admin quản lý đơn hàng, tồn kho, nhập/xuất kho, chuyển kho, phiếu mua hàng và báo cáo.',
        '- Dữ liệu sản phẩm còn hàng hiện tại:',
        liveContext,
      ].join('\n');
    }

    return [
      'Mình là trợ lý BadmintonHub. Mình có thể giải thích chi tiết các phần chính của dự án:',
      '',
      '- User: xem sân, đặt sân thường, đặt lịch cố định, đổi lịch, thanh toán, check-in, xem lịch đặt và mua phụ kiện.',
      '- Nhân viên: quản lý booking theo ngày/tuần/tháng, check-in, hoàn thành, xử lý lịch cố định, duyệt/từ chối yêu cầu đổi lịch.',
      '- Admin: quản lý sân, chi nhánh, user, sản phẩm, kho, đơn hàng, thanh toán và báo cáo.',
      '',
      'Bạn có thể hỏi cụ thể kiểu: "giải thích luồng lịch cố định", "nhân viên từ chối đổi lịch thì user thấy gì", hoặc "trang employee bookings lọc ngày thế nào".',
    ].join('\n');
  }

  private quickReplies() {
    return [
      'Cách đặt sân thường?',
      'Lịch cố định hoạt động thế nào?',
      'Cách đổi lịch cố định?',
      'Thanh toán và check-in ra sao?',
    ];
  }

  private getGeminiApiKey() {
    return (
      this.config.get<string>('GEMINI_API_KEY') ||
      this.config.get<string>('GOOGLE_GENERATIVE_AI_API_KEY') ||
      this.config.get<string>('GOOGLE_API_KEY')
    );
  }

  private getOpenAiApiKey() {
    return this.config.get<string>('OPENAI_API_KEY');
  }

  private normalizeText(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd');
  }

  private includesAny(value: string, keywords: string[]) {
    return keywords.some((keyword) => value.includes(keyword));
  }
}
