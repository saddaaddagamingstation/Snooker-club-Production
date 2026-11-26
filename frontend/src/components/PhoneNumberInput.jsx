
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";

export default function PhoneNumberInput({ value, onChange }) {
  return (
    <PhoneInput
      country="in"
      value={value}
      onChange={(phone, country) => {
        onChange({
          phone: "+" + phone,
          countryCode: "+" + country.dialCode,
          countryISO: country.countryCode
        });
      }}
      enableSearch={true}
      countryCodeEditable={false}
      disableDropdown={false}
      inputStyle={{
        width: "100%",
        height: "40px",
        background: "#101010",
        color: "#ffffff",
        border: "1px solid #292929",
        borderRadius: "8px"
      }}
      buttonStyle={{
        background: "#101010",
        border: "1px solid #292929",
        borderRadius: "8px 0 0 8px"
      }}
      dropdownStyle={{
        background: "#171717",
        color: "#ffffff"
      }}
    />
  );
}
