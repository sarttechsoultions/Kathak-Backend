export function amountToWords(amount: number): string {
  if (amount === 0) return "Zero Only";

  const a = [
    "",
    "One ",
    "Two ",
    "Three ",
    "Four ",
    "Five ",
    "Six ",
    "Seven ",
    "Eight ",
    "Nine ",
    "Ten ",
    "Eleven ",
    "Twelve ",
    "Thirteen ",
    "Fourteen ",
    "Fifteen ",
    "Sixteen ",
    "Seventeen ",
    "Eighteen ",
    "Nineteen ",
  ];
  const b = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  const inWords = (num: number): string => {
    if (num < 20) return a[num];
    if (num < 100) return b[Math.floor(num / 10)] + (num % 10 !== 0 ? " " + a[num % 10] : " ");
    if (num < 1000)
      return (
        a[Math.floor(num / 100)] +
        "Hundred " +
        (num % 100 !== 0 ? "and " + inWords(num % 100) : "")
      );
    if (num < 100000)
      return (
        inWords(Math.floor(num / 1000)) +
        "Thousand " +
        (num % 1000 !== 0 ? inWords(num % 1000) : "")
      );
    if (num < 10000000)
      return (
        inWords(Math.floor(num / 100000)) +
        "Lakh " +
        (num % 100000 !== 0 ? inWords(num % 100000) : "")
      );
    return (
      inWords(Math.floor(num / 10000000)) +
      "Crore " +
      (num % 10000000 !== 0 ? inWords(num % 10000000) : "")
    );
  };

  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);

  let result = "Rupees " + inWords(rupees).trim();

  if (paise > 0) {
    result += " and " + inWords(paise).trim() + " Paise";
  }

  return result + " Only";
}
