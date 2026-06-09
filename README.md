# CIM - Combinatorial Information Markets project

```
Cartesi Rollups Node version: 2.x
```

This project implements a prediction market marketplace based in the concept of [Combinatorial Information Market](https://mason.gmu.edu/~rhanson/combobet.pdf)

## Requirements

- [cartesapp](https://github.com/prototyp3-dev/cartesapp/), an high level framwork for python cartesi rollup app

## Instructions

Install Cartesapp:

```shell
python3 -m venv .venv
. .venv/bin/activate
pip3 install cartesapp[dev]@git+https://github.com/prototyp3-dev/cartesapp@v1.2.6
```

## Setup

Set the `ADMIN_ADDRESS` on the cartesi.toml file under the `[machine]`section:

```shell
envs = ["ADMIN_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"]
```

## Running

Run the App environment with:

```shell
cartesapp node
```

### Running Backend in dev mode

To run the backend in dev mode and speedup the development process you should run

```shell
cartesapp node --dev
```

## Building

Build backend with:

```shell
cartesapp build
```

# References

[Graphical Model Market Maker for Combinatorial Prediction Markets](https://www.jair.org/index.php/jair/article/view/11249/26447)
[Pricing Combinatorial Markets for Tournaments](https://5harad.com/papers/tournaments.pdf)
