package codec

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strings"
)

// FieldDef 描述帧中的一个字段
type FieldDef struct {
	Name    string `json:"name"`
	Bytes   int    `json:"bytes"`
	IsRoute bool   `json:"isRoute"`
	IsSeq   bool   `json:"isSeq"`
}

// FieldDrivenConfig 字段驱动编解码配置
type FieldDrivenConfig struct {
	Fields      []FieldDef
	SizeIndex   int   // size/len 字段的索引
	SeqIndex    int   // seq 字段的索引(-1 无)
	RouteFields []int // route 字段的索引列表
	HeaderSize  int   // 所有 header 字段(不含 payload body)的总字节数
	SizeBytes   int   // size 字段的字节数
	BigEndian   bool  // true 时使用大端序, 默认小端序
}

// NewFieldDrivenConfig 根据字段定义构建配置, 自动检测 size/seq/route 字段索引
func NewFieldDrivenConfig(fields []FieldDef) (*FieldDrivenConfig, error) {
	cfg := &FieldDrivenConfig{
		Fields:    fields,
		SizeIndex: -1,
		SeqIndex:  -1,
	}

	totalBytes := 0
	for i, f := range fields {
		name := strings.ToLower(f.Name)
		if name == "size" || name == "len" {
			cfg.SizeIndex = i
			cfg.SizeBytes = f.Bytes
		}
		if f.IsSeq {
			cfg.SeqIndex = i
		}
		if f.IsRoute {
			cfg.RouteFields = append(cfg.RouteFields, i)
		}
		totalBytes += f.Bytes
	}

	if cfg.SizeIndex < 0 {
		return nil, errors.New("field-driven config: no size/len field found")
	}

	cfg.HeaderSize = totalBytes
	return cfg, nil
}

// PacketConfig 协议帧配置
type PacketConfig struct {
	RouteBytes  int                // route 字段字节数
	SeqBytes    int                // seq 字段字节数
	FieldDriven *FieldDrivenConfig // 非 nil 时启用字段驱动模式
	Pomelo      *PomeloConfig      // 非 nil 时启用 Pomelo 模式
	TopHero     *TopHeroConfig     // 非 nil 时启用 TopHero Thrift Compact 模式
}

// IsFieldDriven 返回是否使用字段驱动模式
func (c PacketConfig) IsFieldDriven() bool {
	return c.FieldDriven != nil
}

// IsPomelo 返回是否使用 Pomelo 模式
func (c PacketConfig) IsPomelo() bool {
	return c.Pomelo != nil
}

// IsTopHero returns whether to use the TopHero custom frame mode.
func (c PacketConfig) IsTopHero() bool {
	return c.TopHero != nil
}

// DefaultPacketConfig 默认帧配置
func DefaultPacketConfig() PacketConfig {
	return PacketConfig{
		RouteBytes: 2,
		SeqBytes:   2,
	}
}

// headerSize size(4) + header(1) 固定部分长度
const headerSize = 5

// Packet 解析后的数据包
type Packet struct {
	Heartbeat   bool   // 是否为心跳包(header 中 h=1)
	ExtCode     uint8  // 扩展操作码 (7 bits)
	Route       uint32 // 消息路由(仅数据包)
	Seq         uint32 // 消息序列号(仅数据包)
	Data        []byte // 消息体(数据包)或心跳时间(心跳包)
	StringRoute string // Pomelo 字符串路由(非空时优先使用)
}

// TopHeroConfig describes the custom frame used by the TopHero Java client:
// flag(2) + seq(2) + msgType(2) + bodyLen(4) + thrift compact body.
type TopHeroConfig struct {
	VerifySequence bool
}

// IsHeartbeat 返回是否为心跳包
func (p *Packet) IsHeartbeat() bool {
	return p.Heartbeat
}

// Encode 将数据包编码为二进制帧
// 字段驱动模式: 按 FieldDrivenConfig 定义小端编码
// Legacy Due 模式: size(4B) + header(1B: h=0 + extcode) + route + seq + message data
func Encode(pkt *Packet, cfg PacketConfig) ([]byte, error) {
	if cfg.IsPomelo() {
		return pomeloEncode(pkt, cfg.Pomelo)
	}
	if cfg.IsTopHero() {
		return topHeroEncode(pkt, cfg.TopHero)
	}
	if cfg.IsFieldDriven() {
		return fieldDrivenEncode(pkt, cfg.FieldDriven)
	}
	if pkt.Heartbeat {
		return encodeHeartbeat(pkt)
	}
	return encodeData(pkt, cfg)
}

// encodeHeartbeat 编码心跳包
func encodeHeartbeat(pkt *Packet) ([]byte, error) {
	// size = header(1)
	payloadSize := 1
	buf := make([]byte, 4+payloadSize)

	// size(不包含 size 字段自身)
	binary.BigEndian.PutUint32(buf[0:4], uint32(payloadSize))

	// header: h=1 + extcode
	buf[4] = 0x80 | (pkt.ExtCode & 0x7F)

	return buf, nil
}

// encodeData 编码数据包
func encodeData(pkt *Packet, cfg PacketConfig) ([]byte, error) {
	if err := validateConfig(cfg); err != nil {
		return nil, err
	}

	// payload = header(1) + route + seq + data
	payloadSize := 1 + cfg.RouteBytes + cfg.SeqBytes + len(pkt.Data)
	buf := make([]byte, 4+payloadSize)

	// size(不包含 size 字段自身)
	binary.BigEndian.PutUint32(buf[0:4], uint32(payloadSize))

	// header: h=0 + extcode
	buf[4] = pkt.ExtCode & 0x7F

	offset := 5

	// route
	putUintN(buf[offset:], pkt.Route, cfg.RouteBytes)
	offset += cfg.RouteBytes

	// seq
	putUintN(buf[offset:], pkt.Seq, cfg.SeqBytes)
	offset += cfg.SeqBytes

	// message data
	copy(buf[offset:], pkt.Data)

	return buf, nil
}

// validateConfig 校验帧配置合法性
func validateConfig(cfg PacketConfig) error {
	switch cfg.RouteBytes {
	case 1, 2, 4:
	default:
		return fmt.Errorf("invalid RouteBytes: %d, must be 1, 2, or 4", cfg.RouteBytes)
	}
	switch cfg.SeqBytes {
	case 0, 1, 2, 4:
	default:
		return fmt.Errorf("invalid SeqBytes: %d, must be 0, 1, 2, or 4", cfg.SeqBytes)
	}
	return nil
}

// putUintN 以大端序将 val 写入 buf 的前 n 字节
func putUintN(buf []byte, val uint32, n int) {
	switch n {
	case 1:
		buf[0] = byte(val)
	case 2:
		binary.BigEndian.PutUint16(buf, uint16(val))
	case 4:
		binary.BigEndian.PutUint32(buf, val)
	}
}

// readUintN 从 buf 中以大端序读取 n 字节
func readUintN(buf []byte, n int) uint32 {
	switch n {
	case 1:
		return uint32(buf[0])
	case 2:
		return uint32(binary.BigEndian.Uint16(buf))
	case 4:
		return binary.BigEndian.Uint32(buf)
	default:
		return 0
	}
}

// DecodeBytes 从完整的字节数组中解码一个数据包
func DecodeBytes(data []byte, cfg PacketConfig) (*Packet, error) {
	if cfg.IsPomelo() {
		return pomeloDecodeBytes(data, cfg.Pomelo)
	}
	if cfg.IsTopHero() {
		return topHeroDecodeBytes(data, cfg.TopHero)
	}
	if cfg.IsFieldDriven() {
		return fieldDrivenDecodeBytes(data, cfg.FieldDriven)
	}
	if len(data) < headerSize {
		return nil, fmt.Errorf("data too short: %d < %d", len(data), headerSize)
	}

	payloadSize := binary.BigEndian.Uint32(data[0:4])
	if int(payloadSize)+4 > len(data) {
		return nil, fmt.Errorf("incomplete packet: need %d bytes, have %d", payloadSize+4, len(data))
	}

	payload := data[4 : 4+payloadSize]
	header := payload[0]
	isHeartbeat := (header & 0x80) != 0
	extCode := header & 0x7F

	pkt := &Packet{
		Heartbeat: isHeartbeat,
		ExtCode:   extCode,
	}

	if isHeartbeat {
		if len(payload) > 1 {
			pkt.Data = payload[1:]
		}
		return pkt, nil
	}

	offset := 1
	minSize := 1 + cfg.RouteBytes + cfg.SeqBytes
	if int(payloadSize) < minSize {
		return nil, fmt.Errorf("invalid data packet: payload size %d < minimum %d", payloadSize, minSize)
	}

	pkt.Route = readUintN(payload[offset:], cfg.RouteBytes)
	offset += cfg.RouteBytes

	if cfg.SeqBytes > 0 {
		pkt.Seq = readUintN(payload[offset:], cfg.SeqBytes)
		offset += cfg.SeqBytes
	}

	if offset < len(payload) {
		pkt.Data = payload[offset:]
	}

	return pkt, nil
}

// Decoder 协议帧解码器, 从 io.Reader 中持续读取并解码帧
type Decoder struct {
	reader io.Reader
	cfg    PacketConfig
}

// NewDecoder 创建解码器
func NewDecoder(reader io.Reader, cfg PacketConfig) *Decoder {
	return &Decoder{reader: reader, cfg: cfg}
}

// Decode 从流中读取并解码下一个完整的数据包
// DecodeRaw 从流中读取下一个完整帧, 返回原始字节(含帧头)
//
// 仅 Pomelo 模式使用, 避免 decode-reencode 导致控制包信息丢失
func (d *Decoder) DecodeRaw() ([]byte, error) {
	if d.cfg.IsPomelo() {
		return pomeloDecodeRaw(d.reader)
	}
	if d.cfg.IsTopHero() {
		pkt, err := d.Decode()
		if err != nil {
			return nil, err
		}
		return Encode(pkt, d.cfg)
	}
	// 非 Pomelo 模式: 解码后重新编码
	pkt, err := d.Decode()
	if err != nil {
		return nil, err
	}
	return Encode(pkt, d.cfg)
}

func (d *Decoder) Decode() (*Packet, error) {
	if d.cfg.IsPomelo() {
		raw, err := pomeloDecodeRaw(d.reader)
		if err != nil {
			return nil, err
		}
		return pomeloDecodeBytes(raw, d.cfg.Pomelo)
	}
	if d.cfg.IsTopHero() {
		return d.decodeTopHero()
	}
	if d.cfg.IsFieldDriven() {
		return d.decodeFieldDriven()
	}

	// 1. 读取 size (4 bytes)
	sizeBuf := make([]byte, 4)
	if _, err := io.ReadFull(d.reader, sizeBuf); err != nil {
		return nil, err
	}
	payloadSize := binary.BigEndian.Uint32(sizeBuf)

	if payloadSize == 0 {
		return nil, errors.New("invalid packet: payload size is 0")
	}

	// 2. 读取整个 payload
	payload := make([]byte, payloadSize)
	if _, err := io.ReadFull(d.reader, payload); err != nil {
		return nil, fmt.Errorf("read payload: %w", err)
	}

	// 3. 解析 header
	header := payload[0]
	isHeartbeat := (header & 0x80) != 0
	extCode := header & 0x7F

	pkt := &Packet{
		Heartbeat: isHeartbeat,
		ExtCode:   extCode,
	}

	if isHeartbeat {
		// 心跳包: 剩余数据为 heartbeat time(如有)
		if len(payload) > 1 {
			pkt.Data = payload[1:]
		}
		return pkt, nil
	}

	// 4. 数据包: 解析 route + seq + message data
	offset := 1
	minSize := 1 + d.cfg.RouteBytes + d.cfg.SeqBytes
	if int(payloadSize) < minSize {
		return nil, fmt.Errorf("invalid data packet: payload size %d < minimum %d", payloadSize, minSize)
	}

	pkt.Route = readUintN(payload[offset:], d.cfg.RouteBytes)
	offset += d.cfg.RouteBytes

	if d.cfg.SeqBytes > 0 {
		pkt.Seq = readUintN(payload[offset:], d.cfg.SeqBytes)
		offset += d.cfg.SeqBytes
	}

	if offset < len(payload) {
		pkt.Data = payload[offset:]
	}

	return pkt, nil
}

// ---- 字段驱动模式(小端序) ----

// putUintNLE 以小端序将 val 写入 buf 的前 n 字节
func putUintNLE(buf []byte, val uint32, n int) {
	switch n {
	case 1:
		buf[0] = byte(val)
	case 2:
		binary.LittleEndian.PutUint16(buf, uint16(val))
	case 4:
		binary.LittleEndian.PutUint32(buf, val)
	}
}

// readUintNLE 从 buf 中以小端序读取 n 字节
func readUintNLE(buf []byte, n int) uint32 {
	switch n {
	case 1:
		return uint32(buf[0])
	case 2:
		return uint32(binary.LittleEndian.Uint16(buf))
	case 4:
		return binary.LittleEndian.Uint32(buf)
	default:
		return 0
	}
}

// splitRouteToFields 将组合路由值拆分为各路由字段值
// 逆向前端 combineRoute: 从右往左按字段字节数依次提取
func splitRouteToFields(route uint32, cfg *FieldDrivenConfig) map[int]uint32 {
	result := make(map[int]uint32)
	value := route
	for i := len(cfg.RouteFields) - 1; i >= 0; i-- {
		idx := cfg.RouteFields[i]
		f := cfg.Fields[idx]
		mask := uint32((1 << (f.Bytes * 8)) - 1)
		result[idx] = value & mask
		value >>= uint(f.Bytes * 8)
	}
	return result
}

// combineRouteFromFields 将各路由字段值组合为单一 uint32
func combineRouteFromFields(values map[int]uint32, cfg *FieldDrivenConfig) uint32 {
	var result uint32
	for _, idx := range cfg.RouteFields {
		f := cfg.Fields[idx]
		result = (result << uint(f.Bytes*8)) | (values[idx] & uint32((1<<(f.Bytes*8))-1))
	}
	return result
}

// putUintNFD 根据 BigEndian 标志选择字节序写入
func (cfg *FieldDrivenConfig) putUintN(buf []byte, val uint32, n int) {
	if cfg.BigEndian {
		putUintN(buf, val, n)
	} else {
		putUintNLE(buf, val, n)
	}
}

// readUintNFD 根据 BigEndian 标志选择字节序读取
func (cfg *FieldDrivenConfig) readUintN(buf []byte, n int) uint32 {
	if cfg.BigEndian {
		return readUintN(buf, n)
	}
	return readUintNLE(buf, n)
}

// fieldDrivenEncode 字段驱动编码
// 帧格式: header fields(按字段定义) + payload body
// size 字段的值 = payload body 的字节数
func fieldDrivenEncode(pkt *Packet, cfg *FieldDrivenConfig) ([]byte, error) {
	totalSize := cfg.HeaderSize + len(pkt.Data)
	buf := make([]byte, totalSize)

	routeValues := splitRouteToFields(pkt.Route, cfg)

	offset := 0
	for i, f := range cfg.Fields {
		var val uint32
		if i == cfg.SizeIndex {
			val = uint32(len(pkt.Data))
		} else if f.IsRoute {
			val = routeValues[i]
		} else if f.IsSeq {
			val = pkt.Seq
		}
		cfg.putUintN(buf[offset:], val, f.Bytes)
		offset += f.Bytes
	}

	// payload body
	copy(buf[offset:], pkt.Data)

	return buf, nil
}

// fieldDrivenDecodeBytes 从完整字节数组中解码一个字段驱动的数据包
func fieldDrivenDecodeBytes(data []byte, cfg *FieldDrivenConfig) (*Packet, error) {
	if len(data) < cfg.HeaderSize {
		return nil, fmt.Errorf("data too short: %d < %d", len(data), cfg.HeaderSize)
	}

	// 解析 header 字段
	routeValues := make(map[int]uint32)
	var seq uint32
	var sizeValue uint32

	offset := 0
	for i, f := range cfg.Fields {
		val := cfg.readUintN(data[offset:], f.Bytes)
		if i == cfg.SizeIndex {
			sizeValue = val
		} else if f.IsRoute {
			routeValues[i] = val
		} else if f.IsSeq {
			seq = val
		}
		offset += f.Bytes
	}

	if cfg.HeaderSize+int(sizeValue) > len(data) {
		return nil, fmt.Errorf("incomplete packet: need %d bytes, have %d", cfg.HeaderSize+int(sizeValue), len(data))
	}

	pkt := &Packet{
		Route: combineRouteFromFields(routeValues, cfg),
		Seq:   seq,
	}
	if sizeValue > 0 {
		pkt.Data = data[cfg.HeaderSize : cfg.HeaderSize+int(sizeValue)]
	}
	return pkt, nil
}

// decodeFieldDriven 字段驱动流式解码
func (d *Decoder) decodeFieldDriven() (*Packet, error) {
	cfg := d.cfg.FieldDriven

	// 1. 读取整个 header
	headerBuf := make([]byte, cfg.HeaderSize)
	if _, err := io.ReadFull(d.reader, headerBuf); err != nil {
		return nil, err
	}

	// 2. 从 header 中提取各字段值
	routeValues := make(map[int]uint32)
	var seq uint32
	var sizeValue uint32

	offset := 0
	for i, f := range cfg.Fields {
		val := cfg.readUintN(headerBuf[offset:], f.Bytes)
		if i == cfg.SizeIndex {
			sizeValue = val
		} else if f.IsRoute {
			routeValues[i] = val
		} else if f.IsSeq {
			seq = val
		}
		offset += f.Bytes
	}

	// 3. 读取 payload body
	var body []byte
	if sizeValue > 0 {
		body = make([]byte, sizeValue)
		if _, err := io.ReadFull(d.reader, body); err != nil {
			return nil, fmt.Errorf("read payload: %w", err)
		}
	}

	return &Packet{
		Route: combineRouteFromFields(routeValues, cfg),
		Seq:   seq,
		Data:  body,
	}, nil
}

const (
	topHeroHeaderSize         = 10
	topHeroFlagVerifySequence = 1
	topHeroFlagCrypto         = 1 << 14
	topHeroFlagCompressed     = 1 << 15
	topHeroCompressMethodNone = 0
	topHeroCompressMethodLZ4  = 1
)

func topHeroEncode(pkt *Packet, cfg *TopHeroConfig) ([]byte, error) {
	if pkt.Route > 0xFFFF {
		return nil, fmt.Errorf("tophero msgType out of range: %d", pkt.Route)
	}
	if pkt.Seq > 0xFFFF {
		return nil, fmt.Errorf("tophero sequence out of range: %d", pkt.Seq)
	}

	flag := uint16(0)
	if cfg == nil || cfg.VerifySequence {
		flag = topHeroFlagVerifySequence
	}

	buf := make([]byte, topHeroHeaderSize+len(pkt.Data))
	binary.BigEndian.PutUint16(buf[0:2], flag)
	binary.BigEndian.PutUint16(buf[2:4], uint16(pkt.Seq))
	binary.BigEndian.PutUint16(buf[4:6], uint16(pkt.Route))
	binary.BigEndian.PutUint32(buf[6:10], uint32(len(pkt.Data)))
	copy(buf[topHeroHeaderSize:], pkt.Data)
	return buf, nil
}

func topHeroDecodeBytes(data []byte, cfg *TopHeroConfig) (*Packet, error) {
	if len(data) < topHeroHeaderSize {
		return nil, fmt.Errorf("data too short: %d < %d", len(data), topHeroHeaderSize)
	}

	flag := binary.BigEndian.Uint16(data[0:2])
	bodyLen := int(binary.BigEndian.Uint32(data[6:10]))
	if len(data) < topHeroHeaderSize+bodyLen {
		return nil, fmt.Errorf("incomplete packet: need %d bytes, have %d", topHeroHeaderSize+bodyLen, len(data))
	}

	body, err := decodeTopHeroPayload(flag, data[topHeroHeaderSize:topHeroHeaderSize+bodyLen])
	if err != nil {
		return nil, err
	}

	return &Packet{
		Seq:   uint32(binary.BigEndian.Uint16(data[2:4])),
		Route: uint32(binary.BigEndian.Uint16(data[4:6])),
		Data:  body,
	}, nil
}

func (d *Decoder) decodeTopHero() (*Packet, error) {
	header := make([]byte, topHeroHeaderSize)
	if _, err := io.ReadFull(d.reader, header); err != nil {
		return nil, err
	}

	flag := binary.BigEndian.Uint16(header[0:2])
	bodyLen := int(binary.BigEndian.Uint32(header[6:10]))
	payload := make([]byte, bodyLen)
	if bodyLen > 0 {
		if _, err := io.ReadFull(d.reader, payload); err != nil {
			return nil, fmt.Errorf("read payload: %w", err)
		}
	}

	body, err := decodeTopHeroPayload(flag, payload)
	if err != nil {
		return nil, err
	}

	return &Packet{
		Seq:   uint32(binary.BigEndian.Uint16(header[2:4])),
		Route: uint32(binary.BigEndian.Uint16(header[4:6])),
		Data:  body,
	}, nil
}

func decodeTopHeroPayload(flag uint16, payload []byte) ([]byte, error) {
	if flag&topHeroFlagCrypto != 0 {
		return nil, errors.New("tophero encrypted payload is not supported yet")
	}
	if len(payload) == 0 {
		return nil, nil
	}
	if flag&topHeroFlagCompressed == 0 {
		return append([]byte(nil), payload...), nil
	}

	body, err := topHeroDecompressPayload(payload)
	if err != nil {
		return nil, fmt.Errorf("decompress tophero payload: %w", err)
	}
	return body, nil
}

func topHeroDecompressPayload(payload []byte) ([]byte, error) {
	out := make([]byte, 0, len(payload))
	for len(payload) > 0 {
		method, size, err := readTopHeroVarint(payload)
		if err != nil {
			return nil, err
		}
		payload = payload[size:]

		decompressedLen, size, err := readTopHeroVarint(payload)
		if err != nil {
			return nil, err
		}
		payload = payload[size:]

		compressedLen := decompressedLen
		switch method {
		case topHeroCompressMethodNone:
		case topHeroCompressMethodLZ4:
			compressedLen, size, err = readTopHeroVarint(payload)
			if err != nil {
				return nil, err
			}
			payload = payload[size:]
		default:
			return nil, fmt.Errorf("unsupported tophero compression method %d", method)
		}

		if compressedLen < 0 || compressedLen > len(payload) {
			return nil, fmt.Errorf("invalid tophero compressed length %d", compressedLen)
		}

		block := payload[:compressedLen]
		payload = payload[compressedLen:]

		switch method {
		case topHeroCompressMethodNone:
			if compressedLen != decompressedLen {
				return nil, fmt.Errorf("invalid tophero plain block length %d, want %d", compressedLen, decompressedLen)
			}
			out = append(out, block...)
		case topHeroCompressMethodLZ4:
			decoded, err := decodeTopHeroLZ4Block(block, decompressedLen)
			if err != nil {
				return nil, err
			}
			out = append(out, decoded...)
		}
	}
	return out, nil
}

func readTopHeroVarint(data []byte) (int, int, error) {
	value := 0
	shift := 0
	for index, current := range data {
		value |= int(current&0x7F) << shift
		if current&0x80 == 0 {
			return value, index + 1, nil
		}
		shift += 7
		if shift > 28 {
			return 0, 0, errors.New("tophero varint is too long")
		}
	}
	return 0, 0, io.ErrUnexpectedEOF
}

func decodeTopHeroLZ4Block(src []byte, dstLen int) ([]byte, error) {
	dst := make([]byte, 0, dstLen)
	for pos := 0; pos < len(src); {
		token := int(src[pos])
		pos++

		literalLen := token >> 4
		if literalLen == 15 {
			extra, size, err := readTopHeroLZ4Length(src[pos:])
			if err != nil {
				return nil, err
			}
			literalLen += extra
			pos += size
		}
		if pos+literalLen > len(src) {
			return nil, io.ErrUnexpectedEOF
		}
		dst = append(dst, src[pos:pos+literalLen]...)
		pos += literalLen
		if pos >= len(src) {
			break
		}

		if pos+2 > len(src) {
			return nil, io.ErrUnexpectedEOF
		}
		offset := int(binary.LittleEndian.Uint16(src[pos : pos+2]))
		pos += 2
		if offset <= 0 || offset > len(dst) {
			return nil, fmt.Errorf("invalid tophero lz4 offset %d", offset)
		}

		matchLen := token & 0x0F
		if matchLen == 15 {
			extra, size, err := readTopHeroLZ4Length(src[pos:])
			if err != nil {
				return nil, err
			}
			matchLen += extra
			pos += size
		}
		matchLen += 4
		if len(dst)+matchLen > dstLen {
			return nil, fmt.Errorf("invalid tophero lz4 match length %d", matchLen)
		}

		start := len(dst) - offset
		for i := 0; i < matchLen; i++ {
			dst = append(dst, dst[start+i])
		}
	}

	if len(dst) != dstLen {
		return nil, fmt.Errorf("invalid tophero lz4 decompressed length %d, want %d", len(dst), dstLen)
	}
	return dst, nil
}

func readTopHeroLZ4Length(data []byte) (int, int, error) {
	value := 0
	for index, current := range data {
		value += int(current)
		if current != 0xFF {
			return value, index + 1, nil
		}
	}
	return 0, 0, io.ErrUnexpectedEOF
}
