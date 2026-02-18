// utils/phoneValidation.js
class PhoneValidator {
  // Nigerian network prefixes
  static networkPrefixes = {
    MTN: [
      "803",
      "806",
      "703",
      "706",
      "813",
      "816",
      "810",
      "814",
      "903",
      "906",
      "913",
      "916",
    ],
    GLO: ["805", "807", "705", "815", "811", "905", "915"],
    AIRTEL: [
      "802",
      "808",
      "708",
      "812",
      "701",
      "902",
      "901",
      "904",
      "907",
      "912",
    ],
    "9MOBILE": ["809", "817", "818", "909", "908"],
  };

  // Validate phone number format and network match
  static validatePhoneNetwork(phoneNumber, network) {
    // Remove +234 if present and normalize
    let normalizedPhone = phoneNumber.replace(/^\+234/, "0").replace(/\s/g, "");

    // Check if it's a valid Nigerian number
    if (!/^[789]\d{9}$/.test(normalizedPhone)) {
      return {
        valid: false,
        error: "Invalid Nigerian phone number format",
      };
    }

    // Get first 4 digits (prefix)
    const prefix = normalizedPhone.substring(0, 3);
    const networkUpper = network.toUpperCase();

    // Check if prefix matches the selected network
    const validPrefixes = this.networkPrefixes[networkUpper];

    if (!validPrefixes) {
      return {
        valid: false,
        error: `Unsupported network: ${network}`,
      };
    }

    if (!validPrefixes.includes(prefix)) {
      // Detect actual network
      const actualNetwork = this.detectNetwork(normalizedPhone);

      return {
        valid: false,
        // error: `Phone number ${phoneNumber} belongs to ${actualNetwork}, not ${network}`,
        error: `Invalid Network Sim Provider`,
        detectedNetwork: actualNetwork,
      };
    }

    return {
      valid: true,
      normalizedPhone: "0" + normalizedPhone, // Ensure it starts with 0,
    };
  }

  // Detect which network a phone number belongs to
  static detectNetwork(phoneNumber) {
    const normalizedPhone = phoneNumber
      .replace(/^\+234/, "0")
      .replace(/\s/g, "");
    const prefix = normalizedPhone.substring(0, 4);

    for (const [network, prefixes] of Object.entries(this.networkPrefixes)) {
      if (prefixes.includes(prefix)) {
        return network;
      }
    }

    return "UNKNOWN";
  }

  // Get all networks with their prefixes (for UI display)
  static getNetworkInfo() {
    return Object.entries(this.networkPrefixes).map(([network, prefixes]) => ({
      network,
      prefixes,
      example: `${prefixes[0]}XXXXXXX`,
    }));
  }
}

module.exports = PhoneValidator;
