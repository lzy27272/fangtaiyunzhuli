package cn.sifangguan.ota.browsersession;

import java.util.ArrayList;
import java.util.List;

final class IpAddressClassifier {
    private IpAddressClassifier() {
    }

    static boolean isPublicRoutable(String literal) {
        var bytes = parse(literal);
        if (bytes.length == 4) {
            return isPublicIpv4(bytes);
        }
        return isPublicIpv6(bytes);
    }

    private static byte[] parse(String literal) {
        if (literal == null
                || literal.isBlank()
                || !literal.equals(literal.strip())
                || literal.contains("%")
                || literal.startsWith("[")
                || literal.endsWith("]")) {
            throw invalidAddress();
        }
        if (literal.contains(":")) {
            return parseIpv6(literal);
        }
        return parseIpv4(literal);
    }

    private static byte[] parseIpv4(String literal) {
        var parts = literal.split("\\.", -1);
        if (parts.length != 4) {
            throw invalidAddress();
        }
        var bytes = new byte[4];
        for (var index = 0; index < parts.length; index++) {
            var part = parts[index];
            if (part.isEmpty()
                    || part.length() > 3
                    || (part.length() > 1 && part.startsWith("0"))
                    || !part.chars().allMatch(Character::isDigit)) {
                throw invalidAddress();
            }
            var value = Integer.parseInt(part);
            if (value > 255) {
                throw invalidAddress();
            }
            bytes[index] = (byte) value;
        }
        return bytes;
    }

    private static byte[] parseIpv6(String literal) {
        if (!literal.equals(literal.toLowerCase()) || literal.contains(".")) {
            throw invalidAddress();
        }
        var compressionIndex = literal.indexOf("::");
        if (compressionIndex != literal.lastIndexOf("::")) {
            throw invalidAddress();
        }

        List<Integer> left;
        List<Integer> right;
        if (compressionIndex >= 0) {
            left = parseIpv6Groups(literal.substring(0, compressionIndex));
            right = parseIpv6Groups(literal.substring(compressionIndex + 2));
            if (left.size() + right.size() >= 8) {
                throw invalidAddress();
            }
        } else {
            left = parseIpv6Groups(literal);
            right = List.of();
            if (left.size() != 8) {
                throw invalidAddress();
            }
        }

        var groups = new ArrayList<Integer>(8);
        groups.addAll(left);
        while (groups.size() + right.size() < 8) {
            groups.add(0);
        }
        groups.addAll(right);
        if (groups.size() != 8) {
            throw invalidAddress();
        }

        var bytes = new byte[16];
        for (var index = 0; index < groups.size(); index++) {
            var value = groups.get(index).intValue();
            bytes[index * 2] = (byte) (value >>> 8);
            bytes[index * 2 + 1] = (byte) value;
        }
        return bytes;
    }

    private static List<Integer> parseIpv6Groups(String value) {
        if (value.isEmpty()) {
            return List.of();
        }
        var parts = value.split(":", -1);
        var groups = new ArrayList<Integer>(parts.length);
        for (var part : parts) {
            if (part.isEmpty()
                    || part.length() > 4
                    || !part.chars().allMatch(character ->
                            Character.digit(character, 16) >= 0)) {
                throw invalidAddress();
            }
            groups.add(Integer.parseInt(part, 16));
        }
        return groups;
    }

    private static boolean isPublicIpv4(byte[] address) {
        var first = unsigned(address[0]);
        var second = unsigned(address[1]);
        var third = unsigned(address[2]);

        if (first == 0
                || first == 10
                || first == 127
                || first >= 224
                || (first == 100 && second >= 64 && second <= 127)
                || (first == 169 && second == 254)
                || (first == 172 && second >= 16 && second <= 31)
                || (first == 192 && second == 168)
                || (first == 198 && (second == 18 || second == 19))) {
            return false;
        }
        if (first == 192 && second == 0 && third == 0) {
            return false;
        }
        if (first == 192 && second == 0 && third == 2) {
            return false;
        }
        if (first == 198 && second == 51 && third == 100) {
            return false;
        }
        return !(first == 203 && second == 0 && third == 113);
    }

    private static boolean isPublicIpv6(byte[] address) {
        var first = unsigned(address[0]);
        var isGlobalUnicast = (first & 0xe0) == 0x20;
        var isDocumentation = first == 0x20
                && unsigned(address[1]) == 0x01
                && unsigned(address[2]) == 0x0d
                && unsigned(address[3]) == 0xb8;
        return isGlobalUnicast && !isDocumentation;
    }

    private static int unsigned(byte value) {
        return Byte.toUnsignedInt(value);
    }

    private static BrowserSessionPolicyException invalidAddress() {
        return new BrowserSessionPolicyException(
                BrowserSessionErrorCode.INVALID_RESOLVED_ADDRESS);
    }
}
