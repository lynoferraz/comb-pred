# %% Imports

import networkx as nx
from IPython.display import Image

from pgmpy.models import JunctionTree
from pgmpy.factors.discrete import DiscreteFactor
from pgmpy.utils import get_example_model

import importlib

# from cim import auto_market_maker
import auto_market_maker

# %% Original model

asia_model = get_example_model('asia')
original_jt = asia_model.to_junction_tree()

pgv_agraph = nx.nx_agraph.to_agraph(original_jt)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('jto_graph.png')
Image('jto_graph.png')

# %% Create model manually

# Manual chest inference
cliques = [ # already moralized and triangulated
    tuple(sorted(["asia","tub"])),
    tuple(sorted(["tub","lung","either"])),
    tuple(sorted(["lung","either","bronc"])),
    tuple(sorted(["bronc","lung","smoke"])),
    tuple(sorted(["either","dysp","bronc"])),
    tuple(sorted(["either","xray"])),
]

edges_indexes = [ # indexes of clique
    (0,1),
    (1,2),
    (2,3),
    (2,4),
    (4,5),
]
edges = []
for edge in edges_indexes:
    edges.append((tuple(cliques[edge[0]]), tuple(cliques[edge[1]])))

jt = JunctionTree()
jt.add_edges_from(edges)

phis = []
jt_vars = set()
for clique in cliques:
    phi = DiscreteFactor(clique, [2 for _ in clique], [1] * 2**len(clique)) #,state_names={v: ['no','yes'] for v in clique})
    jt_vars = jt_vars.union(set(clique))
    phis.append(phi)

jt.add_factors(*phis)

report = {'variables': {'either': 1}, 'evidence': {'lung': 1}, 'value': 0.7}
report2 = {'variables': {'lung': 1}, 'value': 0.9}
b = 72
amm_deposit = 1000
user_desposit = 200
user_id = 0

user_2 = 1
report_2 = {'variables': {'either': 1}, 'evidence': {'lung': 1}, 'value': 0.95}

pgv_agraph = nx.nx_agraph.to_agraph(jt)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('jt_graph.png')
Image('jt_graph.png')

# %% Perform operations


importlib.reload(auto_market_maker)
amm = auto_market_maker.PJTAmm()

amm.deposit_amm(amm_deposit)
amm.initialize(jt, b=b)

amm.deposit_funds(user_id,user_desposit)
# print(amm.get_edit_bounds(report,user_id))
# print(amm.get_expected_funds_value(user_id))
# print(amm.get_edit_cost_delta(report,user_id))
# print(amm.get_user_free_funds(user_id))

# amm.perform_edit({'variables': {'either': 1, 'tub': 0}, 'evidence': {'lung': 1}, 'value': 0.475},0)
# print(amm.query(['either', 'tub'], {'lung': 1}))

amm.perform_edit(report,user_id)

print(amm.get_expected_funds_value(user_id))
print(amm.get_user_free_funds(user_id))

amm.deposit_funds(user_2,user_desposit)
amm.perform_edit(report_2,user_2)

print(amm.query(variables=report['variables'],evidence=report.get('evidence'),user_id=0))
# print(amm.query(variables=['lung','tub','either']))

liq_report, expected_value = amm.simulate_liquidation(user_id=user_id,variables=['either','tub'],evidence=report.get('evidence'))
# liq_report, expected_value = amm.simulate_liquidation(user_id=user_id,variables=report['variables'],evidence=report.get('evidence'))

print(f"Simulated liquidation report: {liq_report}, expected min value after liquidation: {expected_value}")

amm.perform_edit(liq_report,user_id)
print(amm.query(variables=liq_report['variables'],evidence=liq_report.get('evidence'),user_id=user_id))
print(amm.query(variables=liq_report['variables'],evidence=liq_report.get('evidence')))


amm.perform_resolve(('either',1))
print(amm.query(variables=['lung'],user_id=0))
print(amm.query(variables=['lung']))

print(amm.query(variables=[],evidence={'lung':1},user_id=0))
print(amm.query(variables=[],evidence={'lung':1}))

print(amm.get_expected_funds_value(user_id))
print(amm.get_user_free_funds(user_id))
# amm.get_expected_funds_value(user_id)
# amm.get_edit_bounds(report2,user_id)
# amm.get_edit_cost_delta(report2,user_id)

# print(amm.query(variables=report2['variables'],evidence=report2.get('evidence')))
# print(amm.query(variables=report2['variables'],evidence=report2.get('evidence'),user_id=0))

# amm.perform_add('eeu',2,[['asia'],None])

# map_clique_resolve, map_clique_add, new_edges, old_to_new_cliques = auto_market_maker.get_add_variable_instructions(amm._bp.junction_tree,'eeu',2,[['xray'],['dysp']])
# new_jt, min_value_ = auto_market_maker.resolve_jt(amm._bp.junction_tree, map_clique_resolve, map_clique_add, new_edges, old_to_new_cliques)

pgv_agraph = nx.nx_agraph.to_agraph(amm._bp.junction_tree)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('new_jt_graph.png')
Image('new_jt_graph.png')

# %% More operations
importlib.reload(auto_market_maker)
# amm.perform_resolve(('lung',1))
# amm.perform_resolve(('bronc',1))
# amm.perform_resolve(('dysp',1))
# amm.perform_resolve(('tub',1))
# amm.perform_resolve(('smoke',1))
# amm.perform_resolve(('asia',1))
# amm.perform_resolve(('xray',1))
# amm.perform_add('nam',2,[['lung']])
# amm.perform_add('co',2,[['oca'],['cao']])
# amm.perform_add('nam',2,[None])
# amm.perform_add('nam2',2,[None])
# amm.perform_add('nam3',2,[['nam']])
amm.perform_add('nam4',2,[['nam'],['nam2']])

pgv_agraph = nx.nx_agraph.to_agraph(amm._bp.junction_tree)
pgv_agraph.layout(prog='dot')
pgv_agraph.draw('new_jt_graph.png')
Image('new_jt_graph.png')

# %% More operations
# importlib.reload(auto_market_maker)
# auto_market_maker.factor_with_vars(['lung'],amm._bp.junction_tree)

# print(amm.query(variables=report['variables'],evidence=report.get('evidence'),user_id=user_id))
print(amm.get_user_jt(user_id).factors[1])

print(amm.get_user_free_funds(user_id))

print(amm.get_expected_funds_value(user_id))
