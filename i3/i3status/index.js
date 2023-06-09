import { URL } from "url";
import { request } from "https";
import { readFile } from "fs/promises";
import { cpus as cpuInfo, homedir } from "os";
import { exec } from "child_process";
import { createInterface } from "readline/promises";
import { stdin as input, stdout as output } from "process";
import { createRenderer } from "@aminnairi/i3status";
import { join } from "path";

// SETTINGS

const settings = await readFile(join(homedir(), ".config/i3/i3status/settings.json")).then(fileContent => {
  return JSON.parse(fileContent);
}).catch(() => {
  return {
    weather: {
      appid: ""
    }
  };
});

// HELPERS

const toHexadecimal = (number) => {
  const hexadecimal = number.toString(16);

  return hexadecimal.length === 1
    ? `0${hexadecimal}`
    : hexadecimal;
};

const getHexadecimalColorBetween = (color1, color2, ratio) => {
  const red = Math.round(color1.red + (color2.red - color1.red) * ratio);
  const green = Math.round(color1.green + (color2.green - color1.green) * ratio);
  const blue = Math.round(color1.blue + (color2.blue - color1.blue) * ratio);

  return `#${toHexadecimal(red)}${toHexadecimal(green)}${toHexadecimal(blue)}`;
};

const red = {
  red: 255,
  green: 0,
  blue: 0
};

const green = {
  red: 0,
  green: 255,
  blue: 0
};

const json = {
  get: (url) => {
    return new Promise((resolve, reject) => {
      const { hostname, pathname, search } = new URL(url);
      const path = `${pathname}${search}`;

      let data = "";

      const req = request({
        hostname,
        path,
        port: 443,
        method: "GET"
      }, response => {
        response.on("data", chunk => {
          data += chunk.toString();
        });

        response.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      });

      req.on("error", error => {
        reject(error);
      });

      req.end();
    });
  }
};

const execute = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        return reject(error);
      }

      if (stderr) {
        return reject(new Error(stderr));
      }

      resolve(stdout);
    });
  });
};

const ignore = () => { };

// BUSINESS

const getCov19 = async () => {
  return json.get("https://coronavirusapifr.herokuapp.com/data/live/france").then(response => {
    return ` ${Math.round(response[0].TO * 10000) / 100}%`;
  });
};

const getClock = () => {
  const date = new Date();
  return ` ${date.toLocaleDateString("fr-FR")} ${date.toLocaleTimeString("fr-FR")}`;
};

const getBitcoinRate = async () => {
  return json.get("https://api.coindesk.com/v1/bpi/currentprice.json").then(json => {
    return ` ${json.bpi.USD.rate}`;
  });
};

const getWeather = async () => {
  return json.get(`https://api.openweathermap.org/data/2.5/weather?q=paris&appid=${settings.weather.appid}&units=metric`).then(json => {
    return ` ${Math.round((Number(json.main.temp) || 0) * 10) / 10}°C ${json.weather[0].main}`;
  });
};

const getCpus = () => {
  const cpus = cpuInfo();
  const count = cpus.length;
  const speed = Math.round(cpus.reduce((clock, cpu) => clock + cpu.speed, 0) / count) / 1000;

  return ` ${count} CPUs ${speed}GHz`;
};

const getBattery = async () => {
  return Promise.all([
    execute("/usr/bin/cat /sys/class/power_supply/BAT*/capacity"),
    execute("/usr/bin/cat /sys/class/power_supply/BAT*/status")
  ]).then(([rawBattery, rawStatus]) => {
    const battery = Number(rawBattery.trim()) || 0;
    const status = rawStatus.trim();
    const icon = status === "Discharging" ? "" : "";
    const color = status === "Discharging" ? getHexadecimalColorBetween(red, green, battery / 100) : "#00FF00";

    return {
      color,
      full_text: `${icon} ${battery}%`
    }
  });
};

const getBrightness = async () => {
  return execute("/usr/bin/cat /sys/class/backlight/*/brightness").then(brightness => {
    const brightnessLevel = Number(brightness.trim()) || 0;

    return ` ${brightnessLevel}%`;
  });
};

const getVolume = async () => {
  return Promise.all([
    execute("pactl get-sink-volume @DEFAULT_SINK@ | grep 'Volume' | cut -d '/' -f 2"),
    execute("pactl get-sink-mute @DEFAULT_SINK@")
  ]).then(([volume, muted]) => {
    return `${muted.includes("no") ? "" : ""} ${volume.trim()}`;
  });
};

const getMemory = async () => {
  return Promise.all([
    execute("grep MemTotal /proc/meminfo | cut -d ' ' -f 8"),
    execute("grep MemAvailable /proc/meminfo | cut -d ' ' -f 5")
  ]).then(([rawTotalMemory, rawAvailableMemory]) => {
    const totalMemory = Math.round((Number(rawTotalMemory.trim()) || 0) / 100000) / 10;
    const freeMemory = Math.round((Number(rawAvailableMemory.trim()) || 0) / 100000) / 10;

    return ` ${freeMemory}Go / ${totalMemory}Go`;
  });
};

const getDiskSpace = async () => {
  return Promise.all([
    execute("df -h | grep '/\$' | cut -d ' ' -f 7"),
    execute("df -h | grep '/\$' | cut -d ' ' -f 3")
  ]).then(([rawDiskSpaceRemaining, rawDiskSpaceTotal]) => {
    const diskSpaceRemaining = rawDiskSpaceRemaining.trim();
    const diskSpaceTotal = rawDiskSpaceTotal.trim();

    return ` ${diskSpaceRemaining} / ${diskSpaceTotal}`;
  });
};

// SETUP

const render = createRenderer({
  createInterface,
  input,
  output
});

const dispatch = render({
  initialBlocks: [
    {
      name: "disk",
      full_text: "",
      separator: false
    },
    {
      name: "memory",
      full_text: "",
      separator: false
    },
    {
      name: "cpus",
      full_text: getCpus(),
      separator: false
    },
    {
      name: "bitcoin",
      full_text: "",
      separator: false
    },
    {
      name: "cov19",
      full_text: "",
      separator: false
    },
    {
      name: "weather",
      full_text: "",
      separator: false
    },
    {
      name: "battery",
      full_text: "",
      separator: false
    },
    {
      name: "brightness",
      full_text: "",
      separator: false
    },
    {
      name: "volume",
      full_text: "",
      separator: false
    },
    {
      name: "clock",
      full_text: getClock(),
      separator: false
    },
  ],
  onEvent: ({ event: { name, button, modifiers }, dispatch }) => {
    const leftClick = 1;

    if (name === "clock" && button === leftClick && modifiers.length === 1 && modifiers.includes("Control")) {
      return execute("librewolf https://calendar.google.com");
    }

    if (name === "weather" && button === 1 && modifiers.length === 0) {
      return getWeather().then(weather => {
        dispatch({
          name: "WEATHER_SET_FULL_TEXT",
          payload: weather
        });
      }).catch(ignore);
    }

    if (name === "bitcoin" && button === 1) {
      if (modifiers.length === 0) {
        return getBitcoinRate().then(rate => {
          dispatch({
            name: "BITCOIN_SET_FULL_TEXT",
            payload: rate
          });
        }).catch(ignore);
      }

      if (modifiers.length === 1 && modifiers.includes("Control")) {
        return execute("librewolf https://coindesk.com/price/bitcoin");
      }
    }
  },
  onDispatch: ({ blocks, action: { name, payload } }) => {
    switch (name) {
      case "CLOCK_SET_FULL_TEXT":
        return blocks.map(block => {
          if (block.name !== "clock") {
            return block;
          }

          return {
            ...block,
            full_text: payload
          };
        })

      case "BITCOIN_SET_FULL_TEXT":
        return blocks.map(block => {
          if (block.name !== "bitcoin") {
            return block;
          }

          return {
            ...block,
            full_text: payload
          };
        });

      case "WEATHER_SET_FULL_TEXT":
        return blocks.map(block => {
          if (block.name !== "weather") {
            return block;
          }

          return {
            ...block,
            full_text: payload
          };
        });

      case "CPUS_SET_FULL_TEXT":
        return blocks.map(block => {
          if (block.name !== "cpus") {
            return block;
          }

          return {
            ...block,
            full_text: payload
          };
        });

      case "BATTERY_SET_FULL_TEXT_COLOR":
        return blocks.map(block => {
          if (block.name !== "battery") {
            return block;
          }

          return {
            ...block,
            full_text: payload.full_text,
            color: payload.color
          };
        });

      case "BRIGHTNESS_SET_FULL_TEXT":
        return blocks.map(block => {
          if (block.name !== "brightness") {
            return block;
          }

          return {
            ...block,
            full_text: payload
          };
        });

      case "VOLUME_SET_FULL_TEXT":
        return blocks.map(block => {
          if (block.name !== "volume") {
            return block;
          }

          return {
            ...block,
            full_text: payload
          };
        });

      case "MEMORY_SET_FULL_TEXT":
        return blocks.map(block => {
          if (block.name !== "memory") {
            return block;
          }

          return {
            ...block,
            full_text: payload
          };
        });

      case "DISK_SET_FULL_TEXT":
        return blocks.map(block => {
          if (block.name !== "disk") {
            return block;
          }

          return {
            ...block,
            full_text: payload
          };
        });

      case "COV19_SET_FULL_TEXT":
        return blocks.map(block => {
          if (block.name !== "cov19") {
            return block;
          }

          return {
            ...block,
            full_text: payload
          };
        });

      default:
        return blocks;
    }
  }
});

// INTERVALS

setInterval(() => {
  dispatch({
    name: "CLOCK_SET_FULL_TEXT",
    payload: getClock()
  });

  dispatch({
    name: "CPUS_SET_FULL_TEXT",
    payload: getCpus()
  });

  getBattery().then(battery => {
    dispatch({
      name: "BATTERY_SET_FULL_TEXT_COLOR",
      payload: battery
    });
  }).catch(ignore);

  getBrightness().then(brightness => {
    dispatch({
      name: "BRIGHTNESS_SET_FULL_TEXT",
      payload: brightness
    });
  }).catch(ignore);

  getVolume().then(volume => {
    dispatch({
      name: "VOLUME_SET_FULL_TEXT",
      payload: volume
    });
  }).catch(ignore);

  getMemory().then(memory => {
    dispatch({
      name: "MEMORY_SET_FULL_TEXT",
      payload: memory
    });
  }).catch(ignore);

  getDiskSpace().then(diskSpace => {
    dispatch({
      name: "DISK_SET_FULL_TEXT",
      payload: diskSpace
    });
  }).catch(ignore);
}, 1000);

setInterval(() => {
  getBitcoinRate().then(rate => {
    dispatch({
      name: "BITCOIN_SET_FULL_TEXT",
      payload: rate
    });
  }).catch(ignore);
}, 1000 * 60 * 10);

setInterval(() => {
  getWeather().then(weather => {
    dispatch({
      name: "WEATHER_SET_FULL_TEXT",
      payload: weather
    });
  }).catch(ignore);

}, 1000 * 60 * 30);

setInterval(() => {
  getCov19().then(payload => {
    dispatch({
      name: "COV19_SET_FULL_TEXT",
      payload
    });
  }).catch(ignore);
}, 1000 * 60 * 60 * 12);

// INITIAL SETUP

getBitcoinRate().then(rate => {
  dispatch({
    name: "BITCOIN_SET_FULL_TEXT",
    payload: rate
  });
}).catch(ignore);

getWeather().then(weather => {
  dispatch({
    name: "WEATHER_SET_FULL_TEXT",
    payload: weather
  });
}).catch(ignore);

getBattery().then(battery => {
  dispatch({
    name: "BATTERY_SET_FULL_TEXT_COLOR",
    payload: battery
  });
}).catch(ignore);

getBrightness().then(brightness => {
  dispatch({
    name: "BRIGHTNESS_SET_FULL_TEXT",
    payload: brightness
  });
}).catch(ignore);

getVolume().then(volume => {
  dispatch({
    name: "VOLUME_SET_FULL_TEXT",
    payload: volume
  });
}).catch(ignore);

getMemory().then(memory => {
  dispatch({
    name: "MEMORY_SET_FULL_TEXT",
    payload: memory
  });
}).catch(ignore);

getDiskSpace().then(diskSpace => {
  dispatch({
    name: "DISK_SET_FULL_TEXT",
    payload: diskSpace
  });
}).catch(ignore);

getCov19().then(payload => {
  dispatch({
    name: "COV19_SET_FULL_TEXT",
    payload
  });
}).catch(ignore);
