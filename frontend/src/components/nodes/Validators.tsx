import { PureComponent } from "react";

import { NodeConsumer } from "../../context/NodeProvider";

import { onPageChange as P } from "../utils/Pagination";
import { Table } from "../utils/Table";
import PaginationSpinner from "../utils/PaginationSpinner";

import ValidatorsList from "./ValidatorsList";

import { Translate } from "react-localize-redux";

interface Props {
  type: string;
  itemsPerPage: number;
}

class Validators extends PureComponent<Props> {
  static defaultProps = {
    itemsPerPage: 120,
  };

  state = {
    activePage: 0,
    startPage: 1,
    endPage: this.props.itemsPerPage,
  };
  onPageChange = ({ selected }: P) => {
    const { itemsPerPage } = this.props;
    this.setState({
      activePage: selected,
      startPage: selected * itemsPerPage + 1,
      endPage: selected * itemsPerPage + itemsPerPage,
    });
  };

  render() {
    const { activePage, startPage, endPage } = this.state;
    const { type, itemsPerPage } = this.props;

    return (
      <Translate>
        {({ translate }) => (
          <>
            <NodeConsumer>
              {(context) => {
                const validatorType =
                  type === "validators"
                    ? context.currentValidators
                    : context.currentProposals;
                return (
                  <>
                    {validatorType ? (
                      <Table
                        className="validators-section"
                        pagination={
                          validatorType.length > itemsPerPage
                            ? {
                                className: "validators-node-pagination",
                                pageCount: Math.ceil(
                                  validatorType.length / itemsPerPage
                                ),
                                marginPagesDisplayed: 1,
                                pageRangeDisplayed: 3,
                                onPageChange: this.onPageChange,
                              }
                            : undefined
                        }
                      >
                        <thead>
                          <tr className="validators-header-row">
                            <th />
                            <th>#</th>
                            <th>
                              {translate(
                                "component.nodes.Validators.validator"
                              )}
                            </th>
                            <th>
                              {translate("component.nodes.Validators.fee")}
                            </th>
                            <th>
                              {translate(
                                "component.nodes.Validators.delegators"
                              )}
                            </th>
                            <th className="text-right">
                              {translate("component.nodes.Validators.stake")}
                            </th>
                            {type !== "proposals" && (
                              <th>
                                {translate(
                                  "component.nodes.Validators.cumulative_stake"
                                )}
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          <ValidatorsList
                            validators={validatorType}
                            pages={{
                              startPage,
                              endPage,
                              activePage,
                              itemsPerPage,
                            }}
                            cellCount={type === "validators" ? 7 : 6}
                            validatorType={type}
                          />
                        </tbody>
                      </Table>
                    ) : (
                      <PaginationSpinner hidden={false} />
                    )}
                  </>
                );
              }}
            </NodeConsumer>
            <style jsx global>{`
              .validators-node-pagination {
                background-color: #ffffff;
              }
            `}</style>
          </>
        )}
      </Translate>
    );
  }
}

export default Validators;
