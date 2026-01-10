// utils/phoneValidation.js
class PhoneValidator {
  // Nigerian network prefixes
  static networkPrefixes = {
    MTN: [
      "0803",
      "0806",
      "0703",
      "0706",
      "0813",
      "0816",
      "0810",
      "0814",
      "0903",
      "0906",
      "0913",
      "0916",
    ],
    GLO: ["0805", "0807", "0705", "0815", "0811", "0905", "0915"],
    AIRTEL: [
      "0802",
      "0808",
      "0708",
      "0812",
      "0701",
      "0902",
      "0901",
      "0904",
      "0907",
      "0912",
    ],
    "9MOBILE": ["0809", "0817", "0818", "0909", "0908"],
  };

  // Validate phone number format and network match
  static validatePhoneNetwork(phoneNumber, network) {
    // Remove +234 if present and normalize
    let normalizedPhone = phoneNumber.replace(/^\+234/, "0").replace(/\s/g, "");

    // Check if it's a valid Nigerian number
    if (!/^0[789]\d{9}$/.test(normalizedPhone)) {
      return {
        valid: false,
        error: "Invalid Nigerian phone number format",
      };
    }

    // Get first 4 digits (prefix)
    const prefix = normalizedPhone.substring(0, 4);
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
      normalizedPhone,
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
