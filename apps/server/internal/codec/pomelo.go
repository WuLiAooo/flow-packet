package codec

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// Pomelo 外层包类型
const (
	PomeloPacketHandshake    byte = 0x01
	PomeloPacketHandshakeAck byte = 0x02
	PomeloPacketHeartbeat    byte = 0x03
	PomeloPacketData         byte = 0x04
	PomeloPacketKick         byte = 0x05
)

// Pomelo 消息类型
const (
	PomeloMsgRequest  byte = 0x00
	PomeloMsgNotify   byte = 0x01
	PomeloMsgResponse byte = 0x02
	PomeloMsgPush     byte = 0x03
)

// Pomelo flag 位掩码
const (
	pomeloRouteCompressMask byte = 0x01
	pomeloTypeMask          byte = 0x07
)

// PomeloConfig Pomelo 协议配置
type PomeloConfig struct {
	UseRouteCompress bool // 是否使用路由压缩
}

// Pomelo 外层包头大小: type(1B) + length(3B)
const pomeloHeadLength = 4

// PomeloEncodeHandshake 编码握手请求包
func PomeloEncodeHandshake(payload []byte) []byte {
	return pomeloEncodePacket(PomeloPacketHandshake, payload)
}

// PomeloEncodeHandshakeAck 编码握手确认包
func PomeloEncodeHandshakeAck() []byte {
	return pomeloEncodePacket(PomeloPacketHandshakeAck, nil)
}

// PomeloEncodeHeartbeat 编码心跳包
func PomeloEncodeHeartbeat() []byte {
	return pomeloEncodePacket(PomeloPacketHeartbeat, nil)
}

// pomeloEncodePacket 编码 Pomelo 外层包
//
// 帧格式: type(1B) + length(3B, 大端) + data(NB)
func pomeloEncodePacket(pkgType byte, data []byte) []byte {
	buf := make([]byte, pomeloHeadLength+len(data))
	buf[0] = pkgType
	buf[1] = byte(len(data) >> 16)
	buf[2] = byte(len(data) >> 8)
	buf[3] = byte(len(data))
	copy(buf[pomeloHeadLength:], data)
	return buf
}

// pomeloEncodeMessage 编码 Pomelo 内层消息
//
// 帧格式: flag(1B) + [msgId(varint)] + [route] + payload
// Request 类型携带 msgId 和 route, Response 只携带 msgId
// route 有两种编码: 压缩模式(2B uint16) 和字符串模式(1B len + string)
func pomeloEncodeMessage(msgType byte, msgId uint32, route uint32, stringRoute string, data []byte) []byte {
	routeCompress := stringRoute == ""

	flag := msgType << 1
	if routeCompress {
		flag |= pomeloRouteCompressMask
	}

	var buf []byte
	buf = append(buf, flag)

	// Request 和 Response 携带 msgId
	if msgType == PomeloMsgRequest || msgType == PomeloMsgResponse {
		buf = append(buf, encodeVarint(msgId)...)
	}

	// Request, Notify, Push 携带 route
	if msgType == PomeloMsgRequest || msgType == PomeloMsgNotify || msgType == PomeloMsgPush {
		if routeCompress {
			routeBuf := make([]byte, 2)
			binary.BigEndian.PutUint16(routeBuf, uint16(route))
			buf = append(buf, routeBuf...)
		} else {
			// 字符串路由: 1B length + UTF-8 string
			routeBytes := []byte(stringRoute)
			buf = append(buf, byte(len(routeBytes)))
			buf = append(buf, routeBytes...)
		}
	}

	buf = append(buf, data...)
	return buf
}

// pomeloEncode 将 Packet 编码为 Pomelo 二进制帧
//
// 当 Packet.StringRoute 非空时使用字符串路由, 否则使用压缩路由(uint16)
func pomeloEncode(pkt *Packet, cfg *PomeloConfig) ([]byte, error) {
	if pkt.Heartbeat {
		return PomeloEncodeHeartbeat(), nil
	}

	msgData := pomeloEncodeMessage(
		PomeloMsgRequest,
		pkt.Seq,
		pkt.Route,
		pkt.StringRoute,
		pkt.Data,
	)

	return pomeloEncodePacket(PomeloPacketData, msgData), nil
}

// pomeloDecodeBytes 从完整字节数组解码 Pomelo 包
//
// 返回值:
//   - *Packet: 心跳包设置 Heartbeat=true, 控制包设置 ExtCode=包类型, 数据包设置 Route/Seq/Data
func pomeloDecodeBytes(data []byte, cfg *PomeloConfig) (*Packet, error) {
	if len(data) < pomeloHeadLength {
		return nil, fmt.Errorf("pomelo: data too short: %d < %d", len(data), pomeloHeadLength)
	}

	pkgType := data[0]
	length := int(data[1])<<16 | int(data[2])<<8 | int(data[3])

	if pomeloHeadLength+length > len(data) {
		return nil, fmt.Errorf("pomelo: incomplete packet: need %d, have %d", pomeloHeadLength+length, len(data))
	}

	body := data[pomeloHeadLength : pomeloHeadLength+length]

	switch pkgType {
	case PomeloPacketHeartbeat:
		return &Packet{Heartbeat: true}, nil
	case PomeloPacketData:
		return pomeloDecodeMessage(body)
	case PomeloPacketHandshake, PomeloPacketHandshakeAck, PomeloPacketKick:
		// 控制包: ExtCode 标记包类型, Data 存放 body
		return &Packet{ExtCode: pkgType, Data: body}, nil
	default:
		return nil, fmt.Errorf("pomelo: unknown packet type: 0x%02x", pkgType)
	}
}

// pomeloDecodeMessage 解码 Pomelo 内层消息
func pomeloDecodeMessage(data []byte) (*Packet, error) {
	if len(data) < 1 {
		return nil, errors.New("pomelo: message too short")
	}

	flag := data[0]
	offset := 1

	msgType := (flag >> 1) & pomeloTypeMask
	routeCompress := (flag & pomeloRouteCompressMask) != 0

	pkt := &Packet{}

	// Request 和 Response 携带 msgId
	if msgType == PomeloMsgRequest || msgType == PomeloMsgResponse {
		msgId, n, err := decodeVarint(data[offset:])
		if err != nil {
			return nil, fmt.Errorf("pomelo: decode msgId: %w", err)
		}
		pkt.Seq = msgId
		offset += n
	}

	// Request, Notify, Push 携带 route
	if msgType == PomeloMsgRequest || msgType == PomeloMsgNotify || msgType == PomeloMsgPush {
		if routeCompress {
			if offset+2 > len(data) {
				return nil, errors.New("pomelo: route too short")
			}
			pkt.Route = uint32(binary.BigEndian.Uint16(data[offset:]))
			offset += 2
		} else {
			// 字符串路由: 1B length + string
			if offset >= len(data) {
				return nil, errors.New("pomelo: route length missing")
			}
			routeLen := int(data[offset])
			offset++
			if offset+routeLen > len(data) {
				return nil, errors.New("pomelo: route string too short")
			}
			pkt.StringRoute = string(data[offset : offset+routeLen])
			offset += routeLen
		}
	}

	if offset < len(data) {
		pkt.Data = data[offset:]
	}

	return pkt, nil
}

// pomeloDecodeRaw 从流中读取一个完整的 Pomelo 包, 返回原始字节(含包头)
func pomeloDecodeRaw(reader io.Reader) ([]byte, error) {
	head := make([]byte, pomeloHeadLength)
	if _, err := io.ReadFull(reader, head); err != nil {
		return nil, err
	}

	length := int(head[1])<<16 | int(head[2])<<8 | int(head[3])
	raw := make([]byte, pomeloHeadLength+length)
	copy(raw, head)

	if length > 0 {
		if _, err := io.ReadFull(reader, raw[pomeloHeadLength:]); err != nil {
			return nil, fmt.Errorf("pomelo: read body: %w", err)
		}
	}

	return raw, nil
}

// encodeVarint 将 uint32 编码为 varint128
//
// 每字节 7 位有效数据, 最高位为续传标记
func encodeVarint(v uint32) []byte {
	if v == 0 {
		return []byte{0}
	}
	var buf []byte
	for v > 0 {
		b := byte(v & 0x7F)
		v >>= 7
		if v > 0 {
			b |= 0x80
		}
		buf = append(buf, b)
	}
	return buf
}

// decodeVarint 从字节数组解码 varint128
//
// 返回值:
//   - uint32: 解码后的值
//   - int: 消耗的字节数
func decodeVarint(data []byte) (uint32, int, error) {
	var result uint32
	for i := 0; i < len(data) && i < 5; i++ {
		b := data[i]
		result |= uint32(b&0x7F) << (7 * uint(i))
		if (b & 0x80) == 0 {
			return result, i + 1, nil
		}
	}
	return 0, 0, errors.New("varint: too long or incomplete")
}
