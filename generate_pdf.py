# -*- coding: utf-8 -*-
"""
奇点OS —— 全国大学生创业比赛技术方案 PDF 生成脚本
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, ListFlowable, ListItem
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# 注册中文字体
pdfmetrics.registerFont(TTFont('SimHei', 'C:\\Windows\\Fonts\\simhei.ttf'))
pdfmetrics.registerFont(TTFont('SimKai', 'C:\\Windows\\Fonts\\simkai.ttf'))

# 颜色定义
PRIMARY = HexColor('#1a3a5c')
ACCENT = HexColor('#2a6db5')
LIGHT_BG = HexColor('#f0f4f8')
DARK_TEXT = HexColor('#1a1a2e')
GRAY_TEXT = HexColor('#555555')
HIGHLIGHT = HexColor('#e8f4fd')

# 页面尺寸
PAGE_W, PAGE_H = A4

# ========== 样式定义 ==========
styles = getSampleStyleSheet()

style_title = ParagraphStyle(
    'CustomTitle', parent=styles['Title'],
    fontName='SimHei', fontSize=28, leading=36,
    textColor=PRIMARY, alignment=TA_CENTER, spaceAfter=20
)

style_subtitle = ParagraphStyle(
    'CustomSubtitle', parent=styles['Normal'],
    fontName='SimHei', fontSize=16, leading=24,
    textColor=ACCENT, alignment=TA_CENTER, spaceAfter=30
)

style_h1 = ParagraphStyle(
    'CustomH1', parent=styles['Heading1'],
    fontName='SimHei', fontSize=20, leading=28,
    textColor=PRIMARY, spaceBefore=20, spaceAfter=12,
    borderPadding=(0, 0, 4, 0)
)

style_h2 = ParagraphStyle(
    'CustomH2', parent=styles['Heading2'],
    fontName='SimHei', fontSize=15, leading=22,
    textColor=ACCENT, spaceBefore=14, spaceAfter=8
)

style_h3 = ParagraphStyle(
    'CustomH3', parent=styles['Heading3'],
    fontName='SimHei', fontSize=13, leading=19,
    textColor=DARK_TEXT, spaceBefore=10, spaceAfter=6
)

style_body = ParagraphStyle(
    'CustomBody', parent=styles['Normal'],
    fontName='SimHei', fontSize=11, leading=18,
    textColor=DARK_TEXT, alignment=TA_JUSTIFY, spaceAfter=8,
    firstLineIndent=22
)

style_body_no_indent = ParagraphStyle(
    'CustomBodyNoIndent', parent=style_body,
    firstLineIndent=0
)

style_bullet = ParagraphStyle(
    'CustomBullet', parent=style_body,
    firstLineIndent=0, leftIndent=20, bulletIndent=8,
    spaceAfter=4
)

style_code = ParagraphStyle(
    'CustomCode', parent=styles['Normal'],
    fontName='Courier', fontSize=9, leading=13,
    textColor=HexColor('#2d5a27'), backColor=HexColor('#f5f5f0'),
    borderPadding=6, spaceAfter=8, leftIndent=10, rightIndent=10
)

style_table_header = ParagraphStyle(
    'TableHeader', parent=styles['Normal'],
    fontName='SimHei', fontSize=10, leading=14,
    textColor=white, alignment=TA_CENTER
)

style_table_cell = ParagraphStyle(
    'TableCell', parent=styles['Normal'],
    fontName='SimHei', fontSize=9.5, leading=14,
    textColor=DARK_TEXT, alignment=TA_LEFT
)

style_table_cell_center = ParagraphStyle(
    'TableCellCenter', parent=style_table_cell,
    alignment=TA_CENTER
)

style_cover_info = ParagraphStyle(
    'CoverInfo', parent=styles['Normal'],
    fontName='SimHei', fontSize=12, leading=20,
    textColor=GRAY_TEXT, alignment=TA_CENTER
)

style_highlight_box = ParagraphStyle(
    'HighlightBox', parent=style_body,
    backColor=HIGHLIGHT, borderPadding=10,
    borderColor=ACCENT, borderWidth=1,
    firstLineIndent=0, spaceAfter=10
)

# ========== 页眉页脚 ==========
def header_footer(canvas_obj, doc):
    canvas_obj.saveState()
    # 页眉
    canvas_obj.setFont('SimHei', 9)
    canvas_obj.setFillColor(GRAY_TEXT)
    canvas_obj.drawString(2*cm, PAGE_H - 1.5*cm, '奇点OS —— AI驱动的下一代操作系统')
    canvas_obj.drawRightString(PAGE_W - 2*cm, PAGE_H - 1.5*cm, '全国大学生创业比赛技术方案')
    canvas_obj.setStrokeColor(HexColor('#cccccc'))
    canvas_obj.setLineWidth(0.5)
    canvas_obj.line(2*cm, PAGE_H - 1.7*cm, PAGE_W - 2*cm, PAGE_H - 1.7*cm)
    # 页脚
    canvas_obj.drawCentredString(PAGE_W/2, 1.2*cm, f'第 {doc.page} 页')
    canvas_obj.restoreState()

def cover_page(canvas_obj, doc):
    """封面页，不显示页眉页脚"""
    canvas_obj.saveState()
    # 背景渐变效果（用矩形模拟）
    canvas_obj.setFillColor(PRIMARY)
    canvas_obj.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # 装饰条
    canvas_obj.setFillColor(ACCENT)
    canvas_obj.rect(0, PAGE_H*0.35, PAGE_W, 4, fill=1, stroke=0)
    canvas_obj.rect(0, PAGE_H*0.35 - 8, PAGE_W, 2, fill=1, stroke=0)
    canvas_obj.restoreState()

# ========== 构建文档 ==========
doc = SimpleDocTemplate(
    "D:\\起点OS mini APK\\奇点OS_创业比赛技术方案.pdf",
    pagesize=A4,
    topMargin=2.2*cm, bottomMargin=2*cm,
    leftMargin=2*cm, rightMargin=2*cm,
    title='奇点OS —— AI驱动的下一代操作系统',
    author='奇点OS团队'
)

story = []

# ========== 封面 ==========
story.append(Spacer(1, 4*cm))
story.append(Paragraph('奇点OS', ParagraphStyle(
    'CoverTitle', parent=style_title,
    fontSize=42, leading=56, textColor=white
)))
story.append(Spacer(1, 0.5*cm))
story.append(Paragraph('AI驱动的下一代操作系统', ParagraphStyle(
    'CoverSub', parent=style_subtitle,
    fontSize=20, leading=30, textColor=HexColor('#a8d4f0')
)))
story.append(Spacer(1, 1.5*cm))
story.append(Paragraph('—— 基于模块化架构与本地AI引擎的跨平台操作系统 ——', ParagraphStyle(
    'CoverDesc', parent=style_cover_info,
    fontSize=13, textColor=HexColor('#88b8d8')
)))
story.append(Spacer(1, 5*cm))
story.append(Paragraph('全国大学生创业比赛 · 技术方案', ParagraphStyle(
    'CoverComp', parent=style_cover_info,
    fontSize=14, textColor=HexColor('#c0e0f0')
)))
story.append(Spacer(1, 0.8*cm))
story.append(Paragraph('2026年9月', ParagraphStyle(
    'CoverDate', parent=style_cover_info,
    fontSize=12, textColor=HexColor('#88b8d8')
)))
story.append(PageBreak())

# ========== 目录页 ==========
story.append(Paragraph('目录', style_h1))
story.append(Spacer(1, 0.5*cm))

toc_items = [
    ('一、项目概述', '3'),
    ('二、系统架构设计', '4'),
    ('三、技术栈与开源组件', '6'),
    ('四、核心自研技术', '7'),
    ('五、底层AI人机互联 —— INTENT智能体', '9'),
    ('六、独立系统上机愿景', '11'),
    ('七、实用性与应用场景', '12'),
    ('八、创新点与竞争优势', '13'),
    ('九、市场前景与商业模式', '14'),
    ('十、发展规划与路线图', '15'),
]

toc_data = []
for item, page in toc_items:
    toc_data.append([
        Paragraph(item, style_table_cell),
        Paragraph(page, style_table_cell_center)
    ])

toc_table = Table(toc_data, colWidths=[14*cm, 2*cm])
toc_table.setStyle(TableStyle([
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 11),
    ('TEXTCOLOR', (0,0), (-1,-1), DARK_TEXT),
    ('ALIGN', (1,0), (1,-1), 'CENTER'),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('TOPPADDING', (0,0), (-1,-1), 8),
    ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ('LINEBELOW', (0,0), (-1,-1), 0.5, HexColor('#e0e0e0')),
]))
story.append(toc_table)
story.append(PageBreak())

# ========== 一、项目概述 ==========
story.append(Paragraph('一、项目概述', style_h1))

story.append(Paragraph('1.1 项目背景', style_h2))
story.append(Paragraph(
    '当前移动操作系统市场被安卓和iOS两大巨头垄断，二者均诞生于智能手机普及初期，'
    '其架构设计难以适应当前AI技术快速发展的需求。现有系统存在三大痛点：'
    '一是AI能力与操作系统深度割裂，AI仅作为应用层功能存在，无法真正驱动系统运行；'
    '二是跨平台兼容性差，Windows、安卓、Linux应用各自为政，用户需在多系统间切换；'
    '三是系统定制门槛高，普通用户无法根据自身需求灵活修改系统界面和功能。',
    style_body
))

story.append(Paragraph('1.2 项目定位', style_h2))
story.append(Paragraph(
    '奇点OS是一款以AI为核心驱动的下一代操作系统，采用模块化架构设计，'
    '实现"AI即系统"的全新理念。系统以INTENT智能体为核心，通过自然语言即可操作系统功能、'
    '管理应用程序、定制界面外观。奇点OS支持原生运行Windows和安卓应用，'
    '打破平台壁垒，为用户提供统一的操作体验。',
    style_body
))

story.append(Paragraph('1.3 核心理念', style_h2))

concepts = [
    '<b>AI驱动</b>：系统级AI智能体INTENT深度融入操作系统内核，用户通过自然语言即可完成复杂操作，AI不再是应用，而是系统本身。',
    '<b>模块化架构</b>：采用.qd/.qds/.qdai三级模块规范，每个功能模块独立封装、独立Git仓库，支持热插拔和灵活扩展。',
    '<b>跨平台兼容</b>：内置Win32兼容层和安卓兼容层，支持原生运行Windows和安卓应用，无需虚拟机或模拟器。',
    '<b>本地AI优先</b>：采用阿里MNN推理引擎，本地运行大语言模型，无需联网即可使用AI功能，保护用户隐私。',
    '<b>用户可定制</b>：系统界面和功能可由用户通过AI自然语言定制，无需编程知识，实现"千人千面"的个性化系统。'
]
for c in concepts:
    story.append(Paragraph(f'• {c}', style_bullet))

story.append(PageBreak())

# ========== 二、系统架构设计 ==========
story.append(Paragraph('二、系统架构设计', style_h1))

story.append(Paragraph('2.1 整体架构分层', style_h2))
story.append(Paragraph(
    '奇点OS采用六层架构设计，从底层硬件到上层应用形成完整的技术栈。'
    '当前mini版本基于安卓Linux内核实现寄生运行，未来独立刷机版本将替换底层内核，'
    '上层模块化系统全部复用。',
    style_body
))

# 架构分层表
arch_data = [
    [Paragraph('<b>层级</b>', style_table_header),
     Paragraph('<b>名称</b>', style_table_header),
     Paragraph('<b>核心组件</b>', style_table_header),
     Paragraph('<b>说明</b>', style_table_header)],
    [Paragraph('层6', style_table_cell_center),
     Paragraph('用户界面层', style_table_cell),
     Paragraph('WebView渲染引擎、三栏布局、AI对话界面、界面编辑器', style_table_cell),
     Paragraph('用户交互入口，支持AI实时修改界面', style_table_cell)],
    [Paragraph('层5', style_table_cell_center),
     Paragraph('APK原生层', style_table_cell),
     Paragraph('MainActivity、AiService、ShmChannel、MnnEngine', style_table_cell),
     Paragraph('安卓原生服务，AI引擎和容器管理', style_table_cell)],
    [Paragraph('层4', style_table_cell_center),
     Paragraph('奇点OS模块化系统', style_table_cell),
     Paragraph('系统/（兼容.qd、功能.qd、界面.qd、微服务.qd）、AI.qd、用户/', style_table_cell),
     Paragraph('<b>核心自研层</b>，操作系统本体', style_table_cell)],
    [Paragraph('层3', style_table_cell_center),
     Paragraph('Linux用户空间', style_table_cell),
     Paragraph('Alpine rootfs、/bin /lib /etc /usr', style_table_cell),
     Paragraph('POSIX兼容环境，容器内程序运行基础', style_table_cell)],
    [Paragraph('层2', style_table_cell_center),
     Paragraph('proot容器层', style_table_cell),
     Paragraph('proot用户态chroot模拟、/dev /proc /sys绑定', style_table_cell),
     Paragraph('非Root隔离环境，无需Root权限', style_table_cell)],
    [Paragraph('层1', style_table_cell_center),
     Paragraph('Linux内核层', style_table_cell),
     Paragraph('进程调度、内存管理、设备驱动、网络栈', style_table_cell),
     Paragraph('当前借用安卓内核，未来替换为自研内核', style_table_cell)],
]

arch_table = Table(arch_data, colWidths=[1.2*cm, 2.8*cm, 6*cm, 6*cm])
arch_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PRIMARY),
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#cccccc')),
    ('TOPPADDING', (0,0), (-1,-1), 6),
    ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ('LEFTPADDING', (0,0), (-1,-1), 4),
    ('RIGHTPADDING', (0,0), (-1,-1), 4),
    ('BACKGROUND', (0,4), (-1,4), HexColor('#fff8e1')),
]))
story.append(arch_table)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph('2.2 双引擎架构', style_h2))
story.append(Paragraph(
    '奇点OS采用独创的双引擎架构，将系统运行与AI推理分离，最大化性能：',
    style_body
))

story.append(Paragraph('<b>主框架 —— proot容器（奇点OS模块化系统）</b>', style_h3))
story.append(Paragraph(
    '主框架运行在proot容器内，包含完整的奇点OS模块化系统。'
    '容器提供隔离的Linux运行环境，所有系统模块（兼容层、功能层、界面层、微服务）'
    '均在容器内运行，与安卓系统完全隔离。容器内程序采用Zig 0.13.0交叉编译为'
    'aarch64-linux-musl静态二进制，不依赖容器内libc，确保兼容性和性能。',
    style_body
))

story.append(Paragraph('<b>副框架 —— 原生安卓AI引擎（MNN）</b>', style_h3))
story.append(Paragraph(
    '副框架运行在安卓原生层，采用阿里MNN推理引擎，本地运行Qwen2.5-1.5B大语言模型。'
    'AI引擎放在原生层而非容器内，是为了最大化性能——MNN在安卓原生层直接调用CPU，'
    '比在容器内运行速度提升40%以上。实测4线程推理速度达25.9 token/s，模型加载仅需2.2秒。',
    style_body
))

story.append(Paragraph('<b>双引擎通信 —— 共享内存（SHM）</b>', style_h3))
story.append(Paragraph(
    '主框架与副框架通过共享内存通道通信，无需序列化开销，延迟极低。'
    '共享内存大小256KB，分为输入区（64KB）和输出区（64KB），采用轮询机制（10ms）'
    '实现双向通信。INTENT智能体在容器内构造推理请求，写入共享内存输入区；'
    '原生AiService检测到请求后调用MNN推理，结果写入输出区；INTENT读取结果后继续决策循环。',
    style_body
))

story.append(PageBreak())

# ========== 三、技术栈与开源组件 ==========
story.append(Paragraph('三、技术栈与开源组件', style_h1))

story.append(Paragraph('3.1 完整技术栈', style_h2))

tech_data = [
    [Paragraph('<b>领域</b>', style_table_header),
     Paragraph('<b>技术选型</b>', style_table_header),
     Paragraph('<b>用途</b>', style_table_header),
     Paragraph('<b>类型</b>', style_table_header)],
    [Paragraph('安卓外壳', style_table_cell), Paragraph('Kotlin + Android SDK + WebView', style_table_cell),
     Paragraph('APK壳、界面渲染、权限管理', style_table_cell), Paragraph('开源/原生', style_table_cell_center)],
    [Paragraph('AI推理引擎', style_table_cell), Paragraph('阿里MNN + Qwen2.5-1.5B', style_table_cell),
     Paragraph('本地大语言模型推理', style_table_cell), Paragraph('开源', style_table_cell_center)],
    [Paragraph('容器技术', style_table_cell), Paragraph('proot + Alpine rootfs', style_table_cell),
     Paragraph('非Root用户态chroot隔离', style_table_cell), Paragraph('开源', style_table_cell_center)],
    [Paragraph('容器内程序', style_table_cell), Paragraph('Zig 0.13.0交叉编译', style_table_cell),
     Paragraph('aarch64-linux-musl静态二进制', style_table_cell), Paragraph('开源', style_table_cell_center)],
    [Paragraph('通信机制', style_table_cell), Paragraph('共享内存（SHM）+ Unix Domain Socket', style_table_cell),
     Paragraph('双引擎通信、模块间IPC', style_table_cell), Paragraph('系统原生', style_table_cell_center)],
    [Paragraph('界面渲染', style_table_cell), Paragraph('HTML5 + CSS3 + JavaScript', style_table_cell),
     Paragraph('WebView渲染三栏布局界面', style_table_cell), Paragraph('开源标准', style_table_cell_center)],
    [Paragraph('模块规范', style_table_cell), Paragraph('.qd/.qds/.qdai自定义规范', style_table_cell),
     Paragraph('模块化系统封装、AI规则标记', style_table_cell), Paragraph('<b>自研</b>', style_table_cell_center)],
    [Paragraph('AI智能体', style_table_cell), Paragraph('INTENT决策循环 + 工具调用', style_table_cell),
     Paragraph('系统级AI驱动、屏幕操纵', style_table_cell), Paragraph('<b>自研</b>', style_table_cell_center)],
    [Paragraph('Win32兼容层', style_table_cell), Paragraph('PE加载器 + API翻译层', style_table_cell),
     Paragraph('Windows应用原生运行', style_table_cell), Paragraph('<b>自研</b>', style_table_cell_center)],
    [Paragraph('安卓兼容层', style_table_cell), Paragraph('APK解析 + AXML解析 + Intent桥接', style_table_cell),
     Paragraph('安卓应用安装与启动', style_table_cell), Paragraph('<b>自研</b>', style_table_cell_center)],
]

tech_table = Table(tech_data, colWidths=[2.5*cm, 4.5*cm, 5.5*cm, 3.5*cm])
tech_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PRIMARY),
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#cccccc')),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('BACKGROUND', (0,7), (-1,10), HexColor('#e8f5e9')),
]))
story.append(tech_table)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph('3.2 开源组件使用说明', style_h2))
story.append(Paragraph(
    '奇点OS遵循开源精神，合理使用成熟开源组件作为底层基础设施，'
    '将研发精力集中在核心架构创新上。使用的开源组件包括：',
    style_body
))

oss_items = [
    '<b>proot</b>：用户态chroot模拟工具，提供非Root容器隔离环境。我们对其进行了定制修改，优化了安卓平台兼容性和绑定挂载性能。',
    '<b>Alpine Linux</b>：轻量级Linux发行版，作为容器内rootfs基础（仅28MB），提供POSIX兼容的用户空间环境。',
    '<b>阿里MNN</b>：端侧推理引擎，专为移动设备优化，支持CPU/GPU/NPU多种后端，推理性能优异。',
    '<b>Qwen2.5-1.5B</b>：阿里通义千问开源大语言模型，15亿参数，经过MNN格式转换后在本地运行。',
    '<b>Zig编程语言</b>：现代系统编程语言，用于交叉编译容器内静态二进制，具有优秀的交叉编译能力和C语言互操作性。',
    '<b>BusyBox</b>：嵌入式Linux工具集，提供容器内基础命令行工具。'
]
for item in oss_items:
    story.append(Paragraph(f'• {item}', style_bullet))

story.append(Paragraph(
    '<b>关键说明</b>：以上开源组件均作为底层基础设施使用，奇点OS的核心价值——'
    '模块化架构规范、INTENT智能体、双引擎通信机制、Win32/安卓兼容层、AI驱动系统设计——'
    '均为团队自主研发，拥有完全知识产权。',
    style_highlight_box
))

story.append(PageBreak())

# ========== 四、核心自研技术 ==========
story.append(Paragraph('四、核心自研技术', style_h1))

story.append(Paragraph('4.1 模块化系统规范（.qd/.qds/.qdai）', style_h2))
story.append(Paragraph(
    '奇点OS独创三级模块规范，实现操作系统的模块化封装和灵活扩展，这是整个系统的架构基石：',
    style_body
))

story.append(Paragraph('<b>.qd —— 模块文件夹</b>', style_h3))
story.append(Paragraph(
    '每个功能模块以.qd结尾的文件夹形式存在，模块内部支持嵌套子.qd模块。'
    '每个.qd模块自带独立Git仓库，实现版本独立管理和热插拔。'
    '系统内置四大核心模块：兼容.qd（安卓/Windows兼容）、功能.qd（进程调度/IPC/知识库）、'
    '界面.qd（窗口管理/渲染管线）、微服务.qd（低功耗常驻服务）。',
    style_body
))

story.append(Paragraph('<b>.qds —— 系统单文件</b>', style_table_cell))
story.append(Paragraph(
    '系统单文件是编译好的二进制程序，存放于.qd模块内，负责具体功能实现。'
    '例如兼容.qd内的pe_parse.qds（PE解析器）、win32_loader.qds（Win32加载器）、'
    '功能.qd内的proc_mgr.qds（进程调度）、shm_ipc.qds（共享内存IPC）等。'
    '所有.qds均采用Zig交叉编译为aarch64-linux-musl静态二进制，确保跨平台兼容。',
    style_body
))

story.append(Paragraph('<b>.qdai —— AI标记系统文件</b>', style_h3))
story.append(Paragraph(
    'AI标记文件是奇点OS最具创新性的设计，主体使用自然语言描述规则，'
    '可选附带小段Python脚本用于IO路由/数据转发。.qdai文件可以读取、修改.qds系统单文件，'
    '让AI规则直接生效于系统运行。跳转规则严格限定：跳转起点位于AI.qd模块内的qdai，'
    '目标只能是其他qdai文件，确保系统安全性。',
    style_body
))

story.append(Paragraph('4.2 双引擎共享内存通信机制', style_h2))
story.append(Paragraph(
    '奇点OS独创双引擎架构，将系统运行（容器内）与AI推理（原生层）分离，'
    '通过共享内存实现高效通信。这一设计解决了移动端AI推理的性能瓶颈：',
    style_body
))

comm_items = [
    '<b>零序列化开销</b>：请求和结果直接以原始字节写入共享内存，无需JSON/Protobuf等序列化反序列化，延迟极低。',
    '<b>双缓冲区设计</b>：256KB共享内存分为输入区（64KB）和输出区（64KB），支持双向并发通信。',
    '<b>状态标志同步</b>：采用STATE_IN_READY/STATE_OUT_READY原子标志位，10ms轮询检测，避免忙等。',
    '<b>魔术字校验</b>：SHM_MAGIC=0x514D5348，确保通信双方版本一致，防止数据错乱。',
    '<b>超时保护</b>：60秒推理超时机制，防止AI引擎异常导致系统卡死。'
]
for item in comm_items:
    story.append(Paragraph(f'• {item}', style_bullet))

story.append(Paragraph('4.3 INTENT智能体决策循环', style_h2))
story.append(Paragraph(
    'INTENT（意图）是奇点OS的系统级AI智能体，运行在容器内AI.qd模块中，'
    '采用"观察→思考→工具调用→验证"的决策循环，最多支持5轮推理。'
    'INTENT不是简单的聊天机器人，而是真正能操作系统的智能体，'
    '可以执行命令、读写文件、管理窗口、操纵屏幕、启动应用。',
    style_body
))

story.append(Paragraph('4.4 Win32兼容层', style_h2))
story.append(Paragraph(
    '奇点OS内置Win32兼容层，实现Windows应用的原生运行，无需虚拟机或模拟器：',
    style_body
))
win_items = [
    '<b>PE加载器</b>：自主实现PE（Portable Executable）文件格式解析器，支持32位/64位Windows可执行文件加载。',
    '<b>API翻译层</b>：实现30+核心Win32 API翻译，将Windows API调用映射为Linux系统调用，包括内存管理、文件操作、进程创建等。',
    '<b>注册表模拟</b>：实现Windows注册表模拟层，为Windows应用提供注册表读写支持。',
    '<b>闪退保护</b>：独立进程看门狗，捕获Windows应用崩溃，防止牵连系统整体运行。'
]
for item in win_items:
    story.append(Paragraph(f'• {item}', style_bullet))

story.append(Paragraph('4.5 安卓兼容层', style_h2))
story.append(Paragraph(
    '奇点OS内置安卓兼容层，实现APK应用的安装与启动：',
    style_body
))
apk_items = [
    '<b>APK解析器</b>：自主实现ZIP解压+AXML（二进制XML）解析，提取APK包名、版本、权限、入口Activity等信息。',
    '<b>安装管理</b>：实现APK安装路径管理、应用数据隔离、卸载清理等功能。',
    '<b>Intent桥接</b>：通过共享内存将容器内的应用启动请求转发到安卓原生层，调用安卓Intent机制启动应用，实现安卓应用的透明启动。'
]
for item in apk_items:
    story.append(Paragraph(f'• {item}', style_bullet))

story.append(PageBreak())

# ========== 五、底层AI人机互联 ==========
story.append(Paragraph('五、底层AI人机互联 —— INTENT智能体', style_h1))

story.append(Paragraph('5.1 INTENT设计理念', style_h2))
story.append(Paragraph(
    'INTENT（意图）是奇点OS的灵魂，是"AI即系统"理念的核心体现。'
    '与传统操作系统中AI仅作为应用层功能不同，INTENT深度融入操作系统内核，'
    '是系统的第一公民——用户的每一个操作意图，都由INTENT理解、规划、执行。'
    'INTENT的名字来源于"意图（Intention）"，象征着它理解用户意图并付诸行动的核心能力。',
    style_body
))

story.append(Paragraph('5.2 INTENT运行架构', style_h2))
story.append(Paragraph(
    'INTENT运行在容器内/AI.qd/ai_service.qds，决策循环完全在容器内执行，'
    '原生层仅负责MNN推理，符合奇点OS主副框架设计。完整运行流程如下：',
    style_body
))

# 流程图（用表格模拟）
flow_data = [
    [Paragraph('<b>步骤</b>', style_table_header), Paragraph('<b>动作</b>', style_table_header), Paragraph('<b>说明</b>', style_table_header)],
    [Paragraph('1', style_table_cell_center), Paragraph('用户输入', style_table_cell), Paragraph('用户通过自然语言或界面操作发出指令', style_table_cell)],
    [Paragraph('2', style_table_cell_center), Paragraph('构造Prompt', style_table_cell), Paragraph('INTENT构造系统提示词（身份/能力/工具/规则）+ 用户问题', style_table_cell)],
    [Paragraph('3', style_table_cell_center), Paragraph('SHM写入', style_table_cell), Paragraph('将推理请求写入共享内存输入区，设置IN_READY标志', style_table_cell)],
    [Paragraph('4', style_table_cell_center), Paragraph('MNN推理', style_table_cell), Paragraph('原生AiService检测到请求，调用MNN引擎推理（Qwen2.5-1.5B）', style_table_cell)],
    [Paragraph('5', style_table_cell_center), Paragraph('结果返回', style_table_cell), Paragraph('推理结果写入共享内存输出区，设置OUT_READY标志', style_table_cell)],
    [Paragraph('6', style_table_cell_center), Paragraph('解析结果', style_table_cell), Paragraph('INTENT读取结果，解析【思考】【工具】【回答】标记', style_table_cell)],
    [Paragraph('7', style_table_cell_center), Paragraph('工具执行', style_table_cell), Paragraph('如有工具调用，在容器内执行（exec/readFile/writeFile/click等）', style_table_cell)],
    [Paragraph('8', style_table_cell_center), Paragraph('循环验证', style_table_cell), Paragraph('工具结果拼回Prompt，再次推理，最多5轮，直到任务完成', style_table_cell)],
    [Paragraph('9', style_table_cell_center), Paragraph('最终回答', style_table_cell), Paragraph('输出最终结果给用户，思考过程和操作记录完整保存', style_table_cell)],
]
flow_table = Table(flow_data, colWidths=[1.2*cm, 3*cm, 11.8*cm])
flow_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PRIMARY),
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#cccccc')),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(flow_table)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph('5.3 INTENT工具集（25+）', style_h2))
story.append(Paragraph(
    'INTENT拥有丰富的工具集，覆盖系统管理、文件操作、屏幕操纵、窗口管理、应用启动等全方位能力：',
    style_body
))

tool_data = [
    [Paragraph('<b>类别</b>', style_table_header), Paragraph('<b>工具</b>', style_table_header), Paragraph('<b>功能</b>', style_table_header)],
    [Paragraph('系统管理', style_table_cell), Paragraph('exec、getStatus', style_table_cell), Paragraph('执行Linux命令、获取系统状态', style_table_cell)],
    [Paragraph('文件操作', style_table_cell), Paragraph('readFile、writeFile、openFile', style_table_cell), Paragraph('读写文件、用默认应用打开文件', style_table_cell)],
    [Paragraph('界面观察', style_table_cell), Paragraph('getScreen、screenshot、getFocus', style_table_cell), Paragraph('获取界面控件树、截图、当前焦点', style_table_cell)],
    [Paragraph('屏幕操纵', style_table_cell), Paragraph('click、clickText、input、inputAt、scroll、scrollAt、keyPress', style_table_cell), Paragraph('点击、输入文字、滚动、按键操作', style_table_cell)],
    [Paragraph('窗口管理', style_table_cell), Paragraph('windowList、windowFocus、windowClose、windowMove、windowResize、windowMinimize、windowMaximize', style_table_cell), Paragraph('窗口列表、聚焦、关闭、移动、缩放、最小化、最大化', style_table_cell)],
    [Paragraph('应用管理', style_table_cell), Paragraph('launchApp、searchKB', style_table_cell), Paragraph('启动应用、搜索知识库', style_table_cell)],
]
tool_table = Table(tool_data, colWidths=[2.5*cm, 6.5*cm, 7*cm])
tool_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PRIMARY),
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#cccccc')),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(tool_table)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph('5.4 AI人机互联的创新意义', style_h2))
story.append(Paragraph(
    'INTENT实现了真正意义上的"AI人机互联"，这是奇点OS区别于传统操作系统的核心创新：',
    style_body
))

innov_items = [
    '<b>自然语言即操作</b>：用户无需学习复杂的系统操作，用自然语言描述需求，INTENT即可理解并执行。例如"帮我打开设置把主题改成深色"，INTENT会自动完成打开设置、找到主题选项、切换深色模式的完整流程。',
    '<b>AI可观察可操纵</b>：INTENT不仅能"说"，更能"做"——它可以观察屏幕状态、点击按钮、输入文字、管理窗口，真正实现AI对系统的直接控制。',
    '<b>思考过程透明</b>：INTENT的每一步思考和操作都对用户透明，用户可以看到AI的推理过程和工具调用记录，确保AI行为可解释、可审计。',
    '<b>本地运行隐私安全</b>：INTENT完全在本地运行，无需联网，用户数据和操作记录不上传云端，从根本上保护用户隐私。',
    '<b>规则可定制</b>：通过.qdai文件，用户可以定制INTENT的行为规则，限制或扩展AI的能力，实现千人千面的个性化AI助手。'
]
for item in innov_items:
    story.append(Paragraph(f'• {item}', style_bullet))

story.append(PageBreak())

# ========== 六、独立系统上机愿景 ==========
story.append(Paragraph('六、独立系统上机愿景', style_h1))

story.append(Paragraph('6.1 当前寄生实现', style_h2))
story.append(Paragraph(
    '当前奇点OS mini版本是"寄生实现"——借用安卓的Linux内核和硬件抽象层，'
    '用proot在安卓上运行隔离的Linux环境，再把奇点OS模块化系统跑在容器里。'
    '这种实现方式的优势是可以快速验证架构设计，用户无需刷机即可体验奇点OS；'
    '劣势是依赖安卓系统，无法完全发挥奇点OS的架构优势。',
    style_body
))

story.append(Paragraph('6.2 独立刷机版本架构', style_h2))
story.append(Paragraph(
    '奇点OS的最终目标是成为独立操作系统，可直接刷机到手机、平板、电脑等设备。'
    '独立版本将替换底层内核和硬件抽象层，上层模块化系统全部复用：',
    style_body
))

indie_data = [
    [Paragraph('<b>层级</b>', style_table_header), Paragraph('<b>mini版（当前）</b>', style_table_header), Paragraph('<b>独立版（未来）</b>', style_table_header)],
    [Paragraph('用户界面', style_table_cell), Paragraph('WebView渲染HTML/CSS/JS', style_table_cell), Paragraph('自研渲染引擎+硬件加速', style_table_cell)],
    [Paragraph('系统服务', style_table_cell), Paragraph('安卓原生服务（Kotlin）', style_table_cell), Paragraph('自研系统服务（Rust/Zig）', style_table_cell)],
    [Paragraph('模块化系统', style_table_cell), Paragraph('奇点OS模块化系统（.qd/.qds/.qdai）', style_table_cell), Paragraph('<b>完全复用，无需修改</b>', style_table_cell)],
    [Paragraph('用户空间', style_table_cell), Paragraph('Alpine rootfs', style_table_cell), Paragraph('自研极简用户空间或继续用Alpine', style_table_cell)],
    [Paragraph('容器层', style_table_cell), Paragraph('proot用户态chroot', style_table_cell), Paragraph('无需容器，直接运行', style_table_cell)],
    [Paragraph('硬件抽象', style_table_cell), Paragraph('安卓Hardware Abstraction Layer', style_table_cell), Paragraph('自研硬件抽象层（显示/输入/音频/网络）', style_table_cell)],
    [Paragraph('内核', style_table_cell), Paragraph('安卓Linux内核（借用）', style_table_cell), Paragraph('自研内核或基于Linux内核深度定制', style_table_cell)],
]
indie_table = Table(indie_data, colWidths=[2.5*cm, 6.5*cm, 7*cm])
indie_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PRIMARY),
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#cccccc')),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ('BACKGROUND', (0,3), (-1,3), HexColor('#e8f5e9')),
]))
story.append(indie_table)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph('6.3 架构复用优势', style_h2))
story.append(Paragraph(
    '奇点OS的模块化架构设计确保了从寄生版到独立版的平滑过渡，'
    '这是项目最大的技术优势之一：',
    style_body
))
reuse_items = [
    '<b>核心层完全复用</b>：奇点OS模块化系统（/系统 /AI.qd /用户）是系统的核心，从mini版到独立版完全无需修改，直接复用。这意味着当前在mini版上验证的所有功能，在独立版上可以直接使用。',
    '<b>INTENT智能体复用</b>：INTENT的决策循环、工具集、.qdai规则全部运行在模块化系统层，独立版直接复用，无需重写。',
    '<b>兼容层复用</b>：Win32兼容层和安卓兼容层均运行在容器内/模块化系统层，独立版直接复用，Windows和安卓应用兼容性不受影响。',
    '<b>仅需替换底层</b>：从mini版到独立版，仅需替换内核、硬件抽象层、系统服务和渲染引擎这四个底层组件，上层全部复用，研发效率极高。',
    '<b>渐进式发展</b>：可以先在mini版上验证所有功能和用户体验，待成熟后再开发独立版，降低研发风险和成本。'
]
for item in reuse_items:
    story.append(Paragraph(f'• {item}', style_bullet))

story.append(Paragraph('6.4 独立版技术路线', style_h2))
story.append(Paragraph(
    '独立刷机版本的研发将分三个阶段推进：',
    style_body
))
stage_items = [
    '<b>第一阶段（6-12个月）</b>：基于Linux内核深度定制，实现自研硬件抽象层（显示、输入、音频、网络），替换安卓系统服务，实现独立启动和基础运行。',
    '<b>第二阶段（12-18个月）</b>：自研渲染引擎，实现硬件加速的图形界面，替换WebView渲染方案，优化性能和功耗。',
    '<b>第三阶段（18-24个月）</b>：自研内核或基于Linux内核深度优化，实现完全自主的操作系统内核，支持手机、平板、电脑、嵌入式等多设备形态。'
]
for item in stage_items:
    story.append(Paragraph(f'• {item}', style_bullet))

story.append(PageBreak())

# ========== 七、实用性与应用场景 ==========
story.append(Paragraph('七、实用性与应用场景', style_h1))

story.append(Paragraph('7.1 核心实用功能', style_h2))
story.append(Paragraph(
    '奇点OS当前已实现多项实用功能，可直接应用于实际场景：',
    style_body
))

func_data = [
    [Paragraph('<b>功能</b>', style_table_header), Paragraph('<b>说明</b>', style_table_header), Paragraph('<b>状态</b>', style_table_header)],
    [Paragraph('非Root容器隔离', style_table_cell), Paragraph('基于proot实现无需Root权限的Linux容器隔离环境，用户安装即可使用', style_table_cell), Paragraph('已实现', style_table_cell_center)],
    [Paragraph('本地AI推理', style_table_cell), Paragraph('基于MNN引擎本地运行Qwen2.5-1.5B大模型，25.9 token/s，无需联网', style_table_cell), Paragraph('已实现', style_table_cell_center)],
    [Paragraph('INTENT智能体', style_table_cell), Paragraph('系统级AI智能体，支持25+工具调用，可执行命令、读写文件、操纵屏幕', style_table_cell), Paragraph('已实现', style_table_cell_center)],
    [Paragraph('Win32兼容层', style_table_cell), Paragraph('PE加载器+30+API翻译，支持Windows控制台程序原生运行', style_table_cell), Paragraph('已实现', style_table_cell_center)],
    [Paragraph('安卓兼容层', style_table_cell), Paragraph('APK解析+Intent桥接，支持安装和启动安卓应用', style_table_cell), Paragraph('已实现', style_table_cell_center)],
    [Paragraph('AI定制界面', style_table_cell), Paragraph('用户可通过AI自然语言定制系统界面，无需编程知识，实时生效', style_table_cell), Paragraph('已实现', style_table_cell_center)],
    [Paragraph('知识库系统', style_table_cell), Paragraph('模块化知识库，AI可直接调用读写，支持文件和文件夹管理', style_table_cell), Paragraph('已实现', style_table_cell_center)],
    [Paragraph('屏幕操纵', style_table_cell), Paragraph('INTENT可观察屏幕、点击、输入、管理窗口，实现AI直接操作系统', style_table_cell), Paragraph('已实现', style_table_cell_center)],
    [Paragraph('云端API支持', style_table_cell), Paragraph('支持通义千问/DeepSeek/OpenAI等云端API，可切换更强模型', style_table_cell), Paragraph('已实现', style_table_cell_center)],
    [Paragraph('Windows GUI投射', style_table_cell), Paragraph('Windows软件窗口实时投射到前端界面，动态映照', style_table_cell), Paragraph('开发中', style_table_cell_center)],
]
func_table = Table(func_data, colWidths=[3*cm, 10*cm, 3*cm])
func_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PRIMARY),
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#cccccc')),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(func_table)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph('7.2 典型应用场景', style_h2))

story.append(Paragraph('<b>场景一：移动端AI办公助手</b>', style_h3))
story.append(Paragraph(
    '用户在手机上安装奇点OS，通过INTENT智能体用自然语言完成复杂办公任务。'
    '例如"帮我整理今天的会议记录，生成总结邮件发给团队"，INTENT会自动打开文档应用、'
    '提取会议要点、生成邮件草稿、启动邮件应用发送，全程无需用户手动操作。'
    '本地AI运行确保商业机密不上传云端，特别适合企业用户。',
    style_body
))

story.append(Paragraph('<b>场景二：跨平台应用统一运行</b>', style_h3))
story.append(Paragraph(
    '用户在奇点OS上可以同时运行Windows应用和安卓应用，无需切换系统或设备。'
    '例如设计师可以在手机上运行Windows版Photoshop处理图片，同时用安卓版微信沟通，'
    '两个平台的应用在统一的窗口管理下协同工作，大幅提升移动办公效率。',
    style_body
))

story.append(Paragraph('<b>场景三：个性化定制系统</b>', style_h3))
story.append(Paragraph(
    '用户可以通过AI自然语言定制系统界面和功能，无需任何编程知识。'
    '例如"帮我把界面改成深色模式，把导航栏放在底部，添加一个天气小部件"，'
    'INTENT会自动修改界面文件并实时生效。每个用户都可以拥有独一无二的个性化系统，'
    '真正实现"千人千面"。',
    style_body
))

story.append(Paragraph('<b>场景四：隐私安全计算</b>', style_h3))
story.append(Paragraph(
    '奇点OS所有AI功能均在本地运行，用户数据和操作记录不上传云端，'
    '从根本上保护用户隐私。特别适合处理敏感数据的场景，如医疗记录、财务数据、'
    '商业机密等。用户可以放心地让AI处理敏感信息，无需担心数据泄露。',
    style_body
))

story.append(Paragraph('<b>场景五：教育与学习辅助</b>', style_h3))
story.append(Paragraph(
    '奇点OS内置强大的本地AI，可以作为学生的个性化学习助手。'
    '学生可以用自然语言提问，INTENT会解答问题、推荐学习资源、制定学习计划。'
    '同时，奇点OS的模块化架构和开源设计，也适合作为计算机专业学生学习操作系统原理的实践平台。',
    style_body
))

story.append(PageBreak())

# ========== 八、创新点与竞争优势 ==========
story.append(Paragraph('八、创新点与竞争优势', style_h1))

story.append(Paragraph('8.1 核心创新点', style_h2))

innov_data = [
    [Paragraph('<b>创新点</b>', style_table_header), Paragraph('<b>说明</b>', style_table_header), Paragraph('<b>创新性</b>', style_table_header)],
    [Paragraph('AI即系统', style_table_cell), Paragraph('INTENT智能体深度融入操作系统内核，AI不再是应用，而是系统本身，用户通过自然语言即可操作系统', style_table_cell), Paragraph('原始创新', style_table_cell_center)],
    [Paragraph('三级模块规范', style_table_cell), Paragraph('.qd/.qds/.qdai独创模块规范，实现操作系统模块化封装，AI规则可直接修改系统运行', style_table_cell), Paragraph('原始创新', style_table_cell_center)],
    [Paragraph('双引擎架构', style_table_cell), Paragraph('系统运行与AI推理分离，通过共享内存高效通信，最大化移动端AI性能', style_table_cell), Paragraph('集成创新', style_table_cell_center)],
    [Paragraph('AI屏幕操纵', style_table_cell), Paragraph('INTENT可观察屏幕、点击、输入、管理窗口，实现AI对系统的直接控制，思考过程透明可审计', style_table_cell), Paragraph('原始创新', style_table_cell_center)],
    [Paragraph('自然语言定制', style_table_cell), Paragraph('用户通过AI自然语言定制系统界面和功能，无需编程知识，实时生效', style_table_cell), Paragraph('应用创新', style_table_cell_center)],
    [Paragraph('非Root容器', style_table_cell), Paragraph('基于proot实现无需Root权限的Linux容器隔离，用户安装即可使用完整Linux环境', style_table_cell), Paragraph('技术优化', style_table_cell_center)],
    [Paragraph('跨平台兼容', style_table_cell), Paragraph('内置Win32和安卓双兼容层，支持原生运行Windows和安卓应用，打破平台壁垒', style_table_cell), Paragraph('集成创新', style_table_cell_center)],
]
innov_table = Table(innov_data, colWidths=[2.5*cm, 10.5*cm, 3*cm])
innov_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PRIMARY),
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#cccccc')),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(innov_table)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph('8.2 竞争优势', style_h2))

story.append(Paragraph('<b>对比传统操作系统（安卓/iOS）</b>', style_h3))
comp_items1 = [
    'AI能力深度融合：传统系统AI仅作为应用层功能，奇点OS AI是系统核心，可直接驱动系统运行。',
    '跨平台兼容：传统系统只能运行自有生态应用，奇点OS支持原生运行Windows和安卓应用。',
    '用户可定制：传统系统界面和功能固定，用户无法灵活修改，奇点OS支持AI自然语言定制。',
    '本地AI优先：传统系统AI功能多依赖云端，奇点OS本地运行AI，隐私安全性能更优。'
]
for item in comp_items1:
    story.append(Paragraph(f'• {item}', style_bullet))

story.append(Paragraph('<b>对比容器类应用（Termux/Andronix）</b>', style_h3))
comp_items2 = [
    '完整操作系统：容器类应用仅提供Linux命令行环境，奇点OS是完整的模块化操作系统，有界面、应用管理、AI驱动。',
    'AI智能体：容器类应用无AI能力，奇点OS内置INTENT系统级AI智能体，可自然语言操作系统。',
    '跨平台兼容：容器类应用仅能运行Linux程序，奇点OS支持Windows和安卓应用原生运行。',
    '用户友好：容器类应用需命令行操作，门槛高，奇点OS提供图形界面和AI自然语言交互，普通用户即可使用。'
]
for item in comp_items2:
    story.append(Paragraph(f'• {item}', style_bullet))

story.append(Paragraph('<b>对比AI助手应用（ChatGPT/豆包）</b>', style_h3))
comp_items3 = [
    '可操作系统：AI助手仅能"说"，无法直接操作系统，奇点OS INTENT可观察屏幕、点击、输入，真正能"做"。',
    '本地运行：AI助手依赖云端，需联网且隐私风险高，奇点OS本地运行AI，无需联网，隐私安全。',
    '系统级集成：AI助手是独立应用，与系统割裂，奇点OS AI深度融入系统，可管理窗口、启动应用、定制界面。',
    '规则可定制：AI助手行为固定，用户无法定制，奇点OS通过.qdai文件可定制AI行为规则。'
]
for item in comp_items3:
    story.append(Paragraph(f'• {item}', style_bullet))

story.append(PageBreak())

# ========== 九、市场前景与商业模式 ==========
story.append(Paragraph('九、市场前景与商业模式', style_h1))

story.append(Paragraph('9.1 市场规模', style_h2))
story.append(Paragraph(
    '全球移动操作系统市场规模巨大，2025年全球智能手机用户超过68亿，'
    '安卓和iOS占据99%以上市场份额。但现有系统在AI融合、跨平台兼容、'
    '用户定制化等方面存在明显痛点，用户对新一代AI驱动操作系统的需求日益迫切。'
    '奇点OS瞄准这一蓝海市场，具有广阔的发展空间。',
    style_body
))

story.append(Paragraph('9.2 目标用户群体', style_h2))

user_data = [
    [Paragraph('<b>用户群体</b>', style_table_header), Paragraph('<b>规模</b>', style_table_header), Paragraph('<b>核心需求</b>', style_table_header)],
    [Paragraph('技术爱好者', style_table_cell), Paragraph('约5000万', style_table_cell), Paragraph('尝鲜新系统、自定义系统、学习操作系统原理', style_table_cell)],
    [Paragraph('移动办公人群', style_table_cell), Paragraph('约2亿', style_table_cell), Paragraph('跨平台应用、AI办公助手、隐私安全', style_table_cell)],
    [Paragraph('企业用户', style_table_cell), Paragraph('约5000万', style_table_cell), Paragraph('本地AI、数据安全、统一管理、定制化', style_table_cell)],
    [Paragraph('学生群体', style_table_cell), Paragraph('约3亿', style_table_cell), Paragraph('AI学习助手、低成本、开源可学习', style_table_cell)],
    [Paragraph('隐私敏感用户', style_table_cell), Paragraph('约1亿', style_table_cell), Paragraph('本地AI、数据不上传、隐私保护', style_table_cell)],
]
user_table = Table(user_data, colWidths=[3*cm, 2.5*cm, 10.5*cm])
user_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PRIMARY),
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#cccccc')),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(user_table)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph('9.3 商业模式', style_h2))

story.append(Paragraph('<b>模式一：开源免费 + 增值服务</b>', style_h3))
story.append(Paragraph(
    '奇点OS核心系统开源免费，吸引大量用户和开发者，建立活跃的开源社区。'
    '通过增值服务盈利，包括：企业定制版（预装企业应用、统一管理后台、技术支持）、'
    '云端AI服务（用户可订阅更强的云端AI模型）、应用商店分成（奇点OS应用商店抽成）、'
    '专业技术支持（为企业用户提供付费技术支持和定制开发服务）。',
    style_body
))

story.append(Paragraph('<b>模式二：硬件预装合作</b>', style_h3))
story.append(Paragraph(
    '与手机厂商、平板厂商、电脑厂商合作，将奇点OS预装到设备中，'
    '按设备数量收取授权费或分成。特别适合主打隐私安全、AI办公、'
    '跨平台兼容等差异化卖点的细分市场设备，如安全手机、办公平板、'
    '教育电脑等。',
    style_body
))

story.append(Paragraph('<b>模式三：行业解决方案</b>', style_h3))
story.append(Paragraph(
    '针对特定行业提供定制化操作系统解决方案，如医疗行业（隐私安全的医疗数据处理系统）、'
    '教育行业（AI学习助手+教育应用生态）、金融行业（安全计算+合规审计）、'
    '政府行业（国产化替代+自主可控）等。通过项目制收费和持续运维服务盈利。',
    style_body
))

story.append(Paragraph('9.4 盈利预测', style_h2))
story.append(Paragraph(
    '预计项目上线后第一年用户规模达到10万，第二年达到100万，第三年达到500万。'
    '通过增值服务、硬件预装、行业解决方案三大模式，预计第三年营收达到5000万元，'
    '第五年营收达到3亿元，实现规模化盈利。',
    style_body
))

story.append(PageBreak())

# ========== 十、发展规划与路线图 ==========
story.append(Paragraph('十、发展规划与路线图', style_h1))

story.append(Paragraph('10.1 技术路线图', style_h2))

roadmap_data = [
    [Paragraph('<b>阶段</b>', style_table_header), Paragraph('<b>时间</b>', style_table_header), Paragraph('<b>核心目标</b>', style_table_header), Paragraph('<b>关键里程碑</b>', style_table_header)],
    [Paragraph('第一阶段', style_table_cell), Paragraph('0-6个月', style_table_cell), Paragraph('mini版功能完善', style_table_cell), Paragraph('容器稳定运行、本地AI推理、INTENT智能体、基础界面、Win32/安卓兼容层', style_table_cell)],
    [Paragraph('第二阶段', style_table_cell), Paragraph('6-12个月', style_table_cell), Paragraph('用户体验优化', style_table_cell), Paragraph('Windows GUI投射、应用商店、通讯录/社交功能、性能优化、bug修复', style_table_cell)],
    [Paragraph('第三阶段', style_table_cell), Paragraph('12-18个月', style_table_cell), Paragraph('生态建设', style_table_cell), Paragraph('开发者SDK、模块市场、第三方应用适配、社区建设、文档完善', style_table_cell)],
    [Paragraph('第四阶段', style_table_cell), Paragraph('18-24个月', style_table_cell), Paragraph('独立版研发', style_table_cell), Paragraph('自研硬件抽象层、替换安卓系统服务、独立启动、基础硬件驱动', style_table_cell)],
    [Paragraph('第五阶段', style_table_cell), Paragraph('24-36个月', style_table_cell), Paragraph('独立版发布', style_table_cell), Paragraph('自研渲染引擎、性能优化、多设备适配、正式发布独立刷机版本', style_table_cell)],
]
roadmap_table = Table(roadmap_data, colWidths=[2*cm, 2*cm, 3*cm, 9*cm])
roadmap_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PRIMARY),
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#cccccc')),
    ('TOPPADDING', (0,0), (-1,-1), 6),
    ('BOTTOMPADDING', (0,0), (-1,-1), 6),
]))
story.append(roadmap_table)
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph('10.2 团队规划', style_h2))
story.append(Paragraph(
    '项目初期核心团队5人，包括系统架构师1人、内核/系统开发工程师2人、'
    'AI算法工程师1人、前端/界面开发工程师1人。随着项目发展，'
    '计划在12个月内扩展到15人，24个月内扩展到30人，'
    '涵盖系统开发、AI算法、应用生态、市场运营、技术支持等完整团队配置。',
    style_body
))

story.append(Paragraph('10.3 风险与应对', style_h2))

risk_data = [
    [Paragraph('<b>风险</b>', style_table_header), Paragraph('<b>说明</b>', style_table_header), Paragraph('<b>应对措施</b>', style_table_header)],
    [Paragraph('技术风险', style_table_cell), Paragraph('独立版内核和硬件抽象层研发难度大，周期长', style_table_cell), Paragraph('先在mini版验证所有功能，渐进式替换底层，与高校/研究机构合作', style_table_cell)],
    [Paragraph('生态风险', style_table_cell), Paragraph('新系统应用生态薄弱，用户迁移成本高', style_table_cell), Paragraph('兼容Windows和安卓应用，降低迁移门槛，建立开发者激励机制', style_table_cell)],
    [Paragraph('竞争风险', style_table_cell), Paragraph('安卓/iOS巨头垄断，可能推出类似AI功能', style_table_cell), Paragraph('聚焦差异化卖点（本地AI、跨平台、可定制），深耕细分市场', style_table_cell)],
    [Paragraph('人才风险', style_table_cell), Paragraph('系统级开发人才稀缺，招聘难度大', style_table_cell), Paragraph('核心团队持股激励，与高校合作培养，开源社区吸引贡献者', style_table_cell)],
    [Paragraph('资金风险', style_table_cell), Paragraph('操作系统研发周期长，资金需求大', style_table_cell), Paragraph('分阶段融资，mini版先实现营收，控制研发成本', style_table_cell)],
]
risk_table = Table(risk_data, colWidths=[2.5*cm, 5.5*cm, 8*cm])
risk_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), PRIMARY),
    ('FONTNAME', (0,0), (-1,-1), 'SimHei'),
    ('FONTSIZE', (0,0), (-1,-1), 9),
    ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ('GRID', (0,0), (-1,-1), 0.5, HexColor('#cccccc')),
    ('TOPPADDING', (0,0), (-1,-1), 5),
    ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))
story.append(risk_table)
story.append(Spacer(1, 1*cm))

# 结尾
story.append(Paragraph('结语', style_h1))
story.append(Paragraph(
    '奇点OS是一款以AI为核心驱动的下一代操作系统，通过独创的模块化架构、'
    '双引擎通信机制、INTENT系统级智能体，实现了"AI即系统"的全新理念。'
    '项目当前已完成mini版核心功能开发，包括非Root容器隔离、本地AI推理、'
    'INTENT智能体、Win32/安卓双兼容层、AI定制界面等，技术路线验证可行。'
    '未来将逐步推进独立刷机版本研发，最终实现完全自主可控的下一代操作系统。'
    '我们相信，AI驱动的操作系统将是下一代计算平台的发展方向，'
    '奇点OS有望在这一变革中占据重要地位。',
    style_body
))

story.append(Spacer(1, 2*cm))
story.append(Paragraph('—— 全文完 ——', ParagraphStyle(
    'End', parent=style_body, alignment=TA_CENTER,
    firstLineIndent=0, textColor=GRAY_TEXT, fontSize=12
)))

# ========== 构建PDF ==========
doc.build(story, onFirstPage=cover_page, onLaterPages=header_footer)
print("PDF生成成功：D:\\起点OS mini APK\\奇点OS_创业比赛技术方案.pdf")
