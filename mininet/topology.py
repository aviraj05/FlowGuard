"""
FlowGuard Mininet Lab Topology
Requires a Linux host with Mininet, Open vSwitch, and Python 3 installed.
(Not supported natively on Windows).

Topology Architecture:
                [Client Host (h1)]
                        |
                 [Core Switch (s1)]
             /          |          \
   [Backend 1 (h2)] [Backend 2 (h3)] [Backend 3 (h4)]
     10.0.0.1         10.0.0.2         10.0.0.3
"""

import sys
import os

try:
    from mininet.net import Mininet
    from mininet.node import Controller, RemoteController, OVSKernelSwitch
    from mininet.cli import CLI
    from mininet.log import setLogLevel, info
    from mininet.link import TCLink
except ImportError:
    print("[ERROR] Mininet is not installed or current OS does not support Linux network namespaces.")
    print("        FlowGuard provides an Offline Replay Engine on Windows via the backend API.")
    print("        To run this topology, execute inside a Linux VM or WSL2 with Mininet installed.")
    sys.exit(1)


def create_flowguard_topology():
    info("*** Creating Mininet network\n")
    net = Mininet(controller=Controller, switch=OVSKernelSwitch, link=TCLink)

    info("*** Adding Controller\n")
    net.addController('c0')

    info("*** Adding Switch\n")
    s1 = net.addSwitch('s1')

    info("*** Adding Hosts\n")
    client = net.addHost('h1', ip='192.168.1.100/24', defaultRoute='via 192.168.1.1')
    b1 = net.addHost('h2', ip='10.0.0.1/24', defaultRoute='via 10.0.0.254')
    b2 = net.addHost('h3', ip='10.0.0.2/24', defaultRoute='via 10.0.0.254')
    b3 = net.addHost('h4', ip='10.0.0.3/24', defaultRoute='via 10.0.0.254')

    info("*** Creating Links with bandwidth and delay profiles\n")
    net.addLink(client, s1, bw=100, delay='2ms')
    net.addLink(b1, s1, bw=100, delay='1ms')
    net.addLink(b2, s1, bw=100, delay='1ms')
    net.addLink(b3, s1, bw=50, delay='5ms')

    info("*** Starting Network\n")
    net.start()

    info("*** Starting lightweight HTTP servers on backends\n")
    b1.cmd('python3 -m http.server 80 &')
    b2.cmd('python3 -m http.server 80 &')
    b3.cmd('python3 -m http.server 80 &')

    info("*** FlowGuard Lab is ready. Opening CLI...\n")
    CLI(net)

    info("*** Stopping Network\n")
    net.stop()


if __name__ == '__main__':
    setLogLevel('info')
    create_flowguard_topology()
